package com.example.producer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.serialization.StringSerializer;
import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;

import java.net.URI;
import java.time.Instant;
import java.util.Properties;
import java.util.concurrent.CountDownLatch;

public class CryptoKafkaProducer {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public static void main(String[] args) throws Exception {
        String bootstrapServers = getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092");
        String topic = getenv("KAFKA_TOPIC", "crypto-trades");
        String streams = getenv("BINANCE_STREAMS", "btcusdt@trade/ethusdt@trade/solusdt@trade");
        String websocketUrl = "wss://stream.binance.com:9443/stream?streams=" + streams;

        Properties props = new Properties();
        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
        props.put(ProducerConfig.ACKS_CONFIG, "all");
        props.put(ProducerConfig.RETRIES_CONFIG, 3);
        props.put(ProducerConfig.LINGER_MS_CONFIG, 10);

        KafkaProducer<String, String> producer = new KafkaProducer<>(props);
        CountDownLatch latch = new CountDownLatch(1);

        WebSocketClient client = new WebSocketClient(new URI(websocketUrl)) {
            @Override
            public void onOpen(ServerHandshake handshake) {
                System.out.printf("Connected to Binance WebSocket: %s%n", websocketUrl);
            }

            @Override
            public void onMessage(String message) {
                try {
                    JsonNode root = MAPPER.readTree(message);
                    JsonNode data = root.get("data");
                    if (data == null || data.isMissingNode()) {
                        return;
                    }

                    String symbol = data.get("s").asText();
                    String price = data.get("p").asText();
                    String quantity = data.get("q").asText();
                    long tradeTime = data.get("T").asLong();
                    long eventTime = data.get("E").asLong();

                    ObjectNode normalized = MAPPER.createObjectNode();
                    normalized.put("symbol", symbol);
                    normalized.put("price", Double.parseDouble(price));
                    normalized.put("quantity", Double.parseDouble(quantity));
                    normalized.put("tradeTime", tradeTime);
                    normalized.put("eventTime", eventTime);

                    String payload = MAPPER.writeValueAsString(normalized);
                    producer.send(new ProducerRecord<>(topic, symbol, payload), (metadata, exception) -> {
                        if (exception != null) {
                            System.err.printf("Kafka publish failed: %s%n", exception.getMessage());
                        } else {
                            System.out.printf("%s sent to %s partition=%d offset=%d eventTime=%s%n",
                                    symbol, metadata.topic(), metadata.partition(), metadata.offset(), Instant.ofEpochMilli(eventTime));
                        }
                    });
                } catch (Exception ex) {
                    System.err.printf("Failed to normalize Binance message: %s%n", ex.getMessage());
                }
            }

            @Override
            public void onClose(int code, String reason, boolean remote) {
                System.out.printf("WebSocket closed. code=%d reason=%s remote=%s%n", code, reason, remote);
                latch.countDown();
            }

            @Override
            public void onError(Exception ex) {
                System.err.printf("WebSocket error: %s%n", ex.getMessage());
            }
        };

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            try {
                client.close();
                producer.flush();
                producer.close();
            } catch (Exception ignored) {
            }
        }));

        client.connect();
        latch.await();
    }

    private static String getenv(String key, String defaultValue) {
        String value = System.getenv(key);
        return value == null || value.isBlank() ? defaultValue : value;
    }
}
