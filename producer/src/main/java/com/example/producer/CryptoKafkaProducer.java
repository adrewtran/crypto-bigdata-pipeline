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
import java.time.format.DateTimeParseException;
import java.util.Properties;
import java.util.concurrent.CountDownLatch;

public class CryptoKafkaProducer {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public static void main(String[] args) throws Exception {
        String bootstrapServers = getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092");
        String topic = getenv("KAFKA_TOPIC", "crypto-trades");
        String marketDataSource = getenv("MARKET_DATA_SOURCE", "coinbase").toLowerCase();
        String websocketUrl = websocketUrl(marketDataSource);

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
                System.out.printf("Connected to %s WebSocket: %s%n", marketDataSource, websocketUrl);
                if ("coinbase".equals(marketDataSource)) {
                    send(coinbaseSubscription());
                }
            }

            @Override
            public void onMessage(String message) {
                try {
                    ObjectNode normalized = normalizeMessage(marketDataSource, message);
                    if (normalized == null) {
                        return;
                    }

                    String symbol = normalized.get("symbol").asText();
                    long eventTime = normalized.get("eventTime").asLong();
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

    private static String websocketUrl(String marketDataSource) {
        if ("binance".equals(marketDataSource)) {
            String streams = getenv("BINANCE_STREAMS", "btcusdt@trade/ethusdt@trade/solusdt@trade");
            String websocketBaseUrl = getenv("BINANCE_WS_BASE_URL", "wss://stream.binance.us:9443");
            return websocketBaseUrl + "/stream?streams=" + streams;
        }
        return getenv("COINBASE_WS_URL", "wss://ws-feed.exchange.coinbase.com");
    }

    private static String coinbaseSubscription() {
        String productIds = getenv("COINBASE_PRODUCT_IDS", "BTC-USD,ETH-USD,SOL-USD");
        String productsJson = MAPPER.valueToTree(productIds.split(",")).toString();
        return "{\"type\":\"subscribe\",\"channels\":[{\"name\":\"ticker\",\"product_ids\":" + productsJson + "}]}";
    }

    private static ObjectNode normalizeMessage(String marketDataSource, String message) throws Exception {
        JsonNode root = MAPPER.readTree(message);
        if ("binance".equals(marketDataSource)) {
            return normalizeBinance(root);
        }
        return normalizeCoinbase(root);
    }

    private static ObjectNode normalizeBinance(JsonNode root) {
        JsonNode data = root.get("data");
        if (data == null || data.isMissingNode()) {
            return null;
        }

        ObjectNode normalized = MAPPER.createObjectNode();
        normalized.put("symbol", data.get("s").asText());
        normalized.put("price", data.get("p").asDouble());
        normalized.put("quantity", data.get("q").asDouble());
        normalized.put("tradeTime", data.get("T").asLong());
        normalized.put("eventTime", data.get("E").asLong());
        return normalized;
    }

    private static ObjectNode normalizeCoinbase(JsonNode root) {
        if (!"ticker".equals(root.path("type").asText())) {
            return null;
        }

        long eventTime = parseCoinbaseTime(root.path("time").asText());
        ObjectNode normalized = MAPPER.createObjectNode();
        normalized.put("symbol", root.path("product_id").asText().replace("-", "") + "T");
        normalized.put("price", root.path("price").asDouble());
        normalized.put("quantity", root.path("last_size").asDouble());
        normalized.put("tradeTime", eventTime);
        normalized.put("eventTime", eventTime);
        return normalized;
    }

    private static long parseCoinbaseTime(String value) {
        try {
            return Instant.parse(value).toEpochMilli();
        } catch (DateTimeParseException ex) {
            return System.currentTimeMillis();
        }
    }
}
