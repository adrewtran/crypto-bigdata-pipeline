import os
from datetime import datetime

import pandas as pd
import plotly.express as px
import streamlit as st
from pyhive import hive

HIVE_HOST = os.getenv("HIVE_HOST", "hive-server")
HIVE_PORT = int(os.getenv("HIVE_PORT", "10000"))
HIVE_USERNAME = os.getenv("HIVE_USERNAME", "hive")
HIVE_DATABASE = os.getenv("HIVE_DATABASE", "crypto_analytics")
REFRESH_SECONDS = int(os.getenv("DASHBOARD_REFRESH_SECONDS", "5"))

SUMMARY_SQL = """
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

ALERTS_SQL = """
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

SYMBOL_COLORS = {
    "BTCUSDT": "#f59e0b",
    "ETHUSDT": "#38bdf8",
    "SOLUSDT": "#a78bfa",
}

st.set_page_config(page_title="Real-Time Crypto Analytics", layout="wide")

st.markdown(
    """
    <style>
      .block-container {
        padding-top: 1.2rem;
        padding-bottom: 2rem;
        max-width: 1280px;
      }
      h1, h2, h3 {
        letter-spacing: 0;
      }
      div[data-testid="stMetric"] {
        background: #111827;
        border: 1px solid #253044;
        border-radius: 8px;
        padding: 14px 16px;
      }
      div[data-testid="stMetricLabel"] {
        color: #cbd5e1;
      }
      div[data-testid="stMetricValue"] {
        color: #f8fafc;
      }
      .pipeline-header {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        align-items: flex-end;
        border-bottom: 1px solid #e5e7eb;
        padding-bottom: 0.85rem;
        margin-bottom: 1rem;
      }
      .pipeline-title {
        font-size: 1.75rem;
        line-height: 1.15;
        font-weight: 700;
        margin: 0;
      }
      .pipeline-subtitle {
        color: #64748b;
        margin: 0.25rem 0 0;
      }
      .refresh-pill {
        border: 1px solid #d1d5db;
        border-radius: 999px;
        padding: 0.35rem 0.75rem;
        color: #334155;
        white-space: nowrap;
        font-size: 0.9rem;
      }
      @media (max-width: 720px) {
        .pipeline-header {
          display: block;
        }
        .refresh-pill {
          display: inline-block;
          margin-top: 0.75rem;
        }
      }
    </style>
    """,
    unsafe_allow_html=True,
)

st.markdown(
    f"""
    <div class="pipeline-header">
      <div>
        <p class="pipeline-title">Real-Time Crypto Analytics</p>
        <p class="pipeline-subtitle">Coinbase/Binance -> Kafka -> Spark Structured Streaming -> Hive</p>
      </div>
      <div class="refresh-pill">Live refresh: {REFRESH_SECONDS}s</div>
    </div>
    """,
    unsafe_allow_html=True,
)

status_slot = st.empty()
metrics_slot = st.empty()
tables_slot = st.empty()
charts_slot = st.empty()
alerts_slot = st.empty()


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


def latest_by_symbol(df: pd.DataFrame) -> pd.DataFrame:
    return (
        df.sort_values(["symbol", "window_end", "processed_at"])
        .groupby("symbol", as_index=False)
        .tail(1)
        .sort_values("symbol")
    )


def format_money(value: float) -> str:
    return f"${value:,.2f}"


def render_metrics(latest_rows: pd.DataFrame) -> None:
    with metrics_slot.container():
        cols = st.columns(max(len(latest_rows), 1))
        for idx, row in enumerate(latest_rows.itertuples(index=False)):
            with cols[idx]:
                st.metric(
                    label=f"{row.symbol} average",
                    value=format_money(row.avg_price),
                    delta=f"{row.trade_count:,} trades",
                    help=f"{row.coin_name} | {row.category}",
                )


def render_tables(latest_rows: pd.DataFrame) -> None:
    with tables_slot.container():
        st.subheader("Latest Window")
        display_df = latest_rows[
            [
                "symbol",
                "coin_name",
                "avg_price",
                "min_price",
                "max_price",
                "total_volume",
                "trade_count",
                "window_end",
            ]
        ].copy()
        st.dataframe(
            display_df,
            use_container_width=True,
            hide_index=True,
        )


def render_charts(df: pd.DataFrame, latest_rows: pd.DataFrame) -> None:
    with charts_slot.container():
        chart_a, chart_b = st.columns(2)

        volume_fig = px.bar(
            latest_rows,
            x="symbol",
            y="total_volume",
            color="symbol",
            color_discrete_map=SYMBOL_COLORS,
            title="Latest 10-second Volume",
            text_auto=".4f",
        )
        volume_fig.update_layout(showlegend=False, margin=dict(l=8, r=8, t=48, b=8))
        chart_a.plotly_chart(volume_fig, use_container_width=True)

        trade_count_fig = px.bar(
            latest_rows,
            x="symbol",
            y="trade_count",
            color="symbol",
            color_discrete_map=SYMBOL_COLORS,
            title="Latest 10-second Trade Count",
            text_auto=True,
        )
        trade_count_fig.update_layout(showlegend=False, margin=dict(l=8, r=8, t=48, b=8))
        chart_b.plotly_chart(trade_count_fig, use_container_width=True)

        price_fig = px.line(
            df.sort_values("window_end"),
            x="window_end",
            y="avg_price",
            color="symbol",
            color_discrete_map=SYMBOL_COLORS,
            markers=True,
            title="Average Price Trend",
        )
        price_fig.update_layout(legend_title_text="", margin=dict(l=8, r=8, t=48, b=8))
        st.plotly_chart(price_fig, use_container_width=True)


def render_alerts(alerts_df: pd.DataFrame) -> None:
    with alerts_slot.container():
        st.subheader("Alerts")
        if alerts_df.empty:
            st.info("No alerts yet. Alerts appear when trade activity crosses the configured threshold.")
            return

        st.dataframe(alerts_df, use_container_width=True, hide_index=True)


def render_dashboard(df: pd.DataFrame, alerts_df: pd.DataFrame) -> None:
    if df.empty:
        status_slot.warning(
            "No Hive data yet. Run the producer and Spark streaming job, then wait for a few 10-second windows."
        )
        metrics_slot.empty()
        tables_slot.empty()
        charts_slot.empty()
        alerts_slot.empty()
        return

    status_slot.success(
        f"Connected to Hive. Last updated {datetime.now().strftime('%H:%M:%S')}."
    )
    latest_rows = latest_by_symbol(df)
    render_metrics(latest_rows)
    render_tables(latest_rows)
    render_charts(df, latest_rows)
    render_alerts(alerts_df)


@st.experimental_fragment(run_every=f"{REFRESH_SECONDS}s")
def live_dashboard() -> None:
    try:
        summary_df = run_query(SUMMARY_SQL)
        alerts_df = run_query(ALERTS_SQL)
        render_dashboard(summary_df, alerts_df)
    except Exception as exc:
        status_slot.error("Dashboard cannot read Hive yet. Start Hive, Spark streaming, and the producer first.")
        metrics_slot.empty()
        tables_slot.empty()
        charts_slot.empty()
        alerts_slot.exception(exc)


live_dashboard()
