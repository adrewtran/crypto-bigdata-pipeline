import os
import pandas as pd
import plotly.express as px
import streamlit as st
from pyhive import hive
from streamlit_autorefresh import st_autorefresh

HIVE_HOST = os.getenv("HIVE_HOST", "hive-server")
HIVE_PORT = int(os.getenv("HIVE_PORT", "10000"))
HIVE_USERNAME = os.getenv("HIVE_USERNAME", "hive")
HIVE_DATABASE = os.getenv("HIVE_DATABASE", "crypto_analytics")

st.set_page_config(page_title="Real-Time Crypto Analytics Pipeline", layout="wide")
st.title("Real-Time Crypto Analytics Pipeline")
st.caption("Binance WebSocket → Java Kafka Producer → Kafka → Spark Structured Streaming → Hive → Streamlit")

st_autorefresh(interval=5_000, key="crypto_dashboard_refresh")

@st.cache_data(ttl=5)
def run_query(sql: str) -> pd.DataFrame:
    conn = hive.Connection(
        host=HIVE_HOST,
        port=HIVE_PORT,
        username=HIVE_USERNAME,
        database=HIVE_DATABASE,
        auth="NONE",
    )
    try:
        return pd.read_sql(sql, conn)
    finally:
        conn.close()

summary_sql = """
SELECT
  window_start,
  window_end,
  symbol,
  coin_name,
  category,
  avg_price,
  min_price,
  max_price,
  total_volume,
  trade_count,
  processed_at
FROM crypto_analytics.crypto_trade_summary
ORDER BY processed_at DESC, window_end DESC
LIMIT 300
"""

alerts_sql = """
SELECT
  window_start,
  window_end,
  symbol,
  coin_name,
  alert_type,
  alert_message,
  current_avg_price,
  processed_at
FROM crypto_analytics.crypto_alerts
ORDER BY processed_at DESC
LIMIT 50
"""

try:
    df = run_query(summary_sql)
    alerts_df = run_query(alerts_sql)
except Exception as exc:
    st.error("Dashboard cannot read Hive yet. Start Hive, Spark streaming, and the producer first.")
    st.exception(exc)
    st.stop()

if df.empty:
    st.warning("No Hive data yet. Run the producer and Spark streaming job, then wait for a few 10-second micro-batches.")
    st.stop()

latest_rows = (
    df.sort_values(["symbol", "window_end", "processed_at"])
      .groupby("symbol", as_index=False)
      .tail(1)
      .sort_values("symbol")
)

cols = st.columns(len(latest_rows))
for idx, row in enumerate(latest_rows.itertuples(index=False)):
    with cols[idx]:
        st.metric(
            label=f"{row.symbol} avg price",
            value=f"${row.avg_price:,.2f}",
            help=f"{row.coin_name} | {row.category}",
        )

st.subheader("Latest Min / Max Price")
st.dataframe(
    latest_rows[["symbol", "coin_name", "avg_price", "min_price", "max_price", "total_volume", "trade_count", "window_end"]],
    use_container_width=True,
)

volume_fig = px.bar(
    latest_rows,
    x="symbol",
    y="total_volume",
    title="Latest 10-second Total Volume by Symbol",
    text_auto=True,
)
st.plotly_chart(volume_fig, use_container_width=True)

trade_count_fig = px.bar(
    latest_rows,
    x="symbol",
    y="trade_count",
    title="Latest 10-second Trade Count by Symbol",
    text_auto=True,
)
st.plotly_chart(trade_count_fig, use_container_width=True)

price_fig = px.line(
    df.sort_values("window_end"),
    x="window_end",
    y="avg_price",
    color="symbol",
    title="Average Price Trend from Hive",
)
st.plotly_chart(price_fig, use_container_width=True)

st.subheader("Latest Alerts")
if alerts_df.empty:
    st.info("No alerts yet. Alerts are generated when a symbol has high trade activity in a 10-second window.")
else:
    st.dataframe(alerts_df, use_container_width=True)
