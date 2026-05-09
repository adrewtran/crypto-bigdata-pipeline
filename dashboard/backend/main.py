import os
import warnings
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pyhive import hive

HIVE_HOST = os.getenv("HIVE_HOST", "hive-server")
HIVE_PORT = int(os.getenv("HIVE_PORT", "10000"))
HIVE_USERNAME = os.getenv("HIVE_USERNAME", "hive")
HIVE_DATABASE = os.getenv("HIVE_DATABASE", "crypto_analytics")
REFRESH_SECONDS = int(os.getenv("DASHBOARD_REFRESH_SECONDS", "5"))
SUMMARY_FETCH_LIMIT = int(os.getenv("DASHBOARD_SUMMARY_FETCH_LIMIT", "1000"))
SUMMARY_RESPONSE_LIMIT = int(os.getenv("DASHBOARD_SUMMARY_RESPONSE_LIMIT", "300"))
ALERTS_FETCH_LIMIT = int(os.getenv("DASHBOARD_ALERTS_FETCH_LIMIT", "300"))
ALERTS_RESPONSE_LIMIT = int(os.getenv("DASHBOARD_ALERTS_RESPONSE_LIMIT", "50"))

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
LIMIT {limit}
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
LIMIT {limit}
"""

HIVE_READ_WARNING = "pandas only supports SQLAlchemy connectable"

response_cache: dict[str, dict[str, Any]] = {}

ROOT_DIR = Path(__file__).resolve().parents[1]
STATIC_DIR = ROOT_DIR / "frontend" / "dist"

app = FastAPI(title="CS523 Big data project")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


def run_query(sql: str) -> pd.DataFrame:
    conn = hive.Connection(
        host=HIVE_HOST,
        port=HIVE_PORT,
        username=HIVE_USERNAME,
        database=HIVE_DATABASE,
        auth="NONE",
    )
    try:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message=f".*{HIVE_READ_WARNING}.*", category=UserWarning)
            return pd.read_sql(sql, conn)
    finally:
        conn.close()


def sorted_limited_frame(df: pd.DataFrame, sort_columns: list[str], limit: int) -> pd.DataFrame:
    if df.empty:
        return df

    available_columns = [column for column in sort_columns if column in df.columns]
    if available_columns:
        df = df.sort_values(available_columns, ascending=[False] * len(available_columns), kind="mergesort")
    return df.head(limit)


def records_from_dataframe(df: pd.DataFrame) -> list[dict[str, Any]]:
    if df.empty:
        return []

    clean_df = df.where(pd.notnull(df), None)
    records = clean_df.to_dict(orient="records")
    for row in records:
        for key, value in row.items():
            if hasattr(value, "isoformat"):
                row[key] = value.isoformat()
    return records


def hive_payload(
    cache_key: str,
    sql: str,
    sort_columns: list[str],
    response_limit: int,
) -> dict[str, Any]:
    try:
        df = run_query(sql)
    except Exception as exc:
        cached_payload = response_cache.get(cache_key)
        if cached_payload is not None:
            return {
                **cached_payload,
                "stale": True,
                "warning": "Hive data is temporarily unavailable. Showing the last successful result.",
            }

        raise HTTPException(
            status_code=503,
            detail="Hive data is not available yet.",
        ) from exc

    payload = {
        "data": records_from_dataframe(sorted_limited_frame(df, sort_columns, response_limit)),
        "refreshSeconds": REFRESH_SECONDS,
        "stale": False,
    }
    response_cache[cache_key] = payload
    return payload


@app.get("/api/health")
def health() -> dict[str, Any]:
    try:
        run_query("SELECT 1")
        hive_status = "connected"
    except Exception:
        hive_status = "unavailable"

    return {
        "status": "ok",
        "hive": hive_status,
        "refreshSeconds": REFRESH_SECONDS,
    }


@app.get("/api/summary")
def summary() -> dict[str, Any]:
    return hive_payload(
        "summary",
        SUMMARY_SQL.format(limit=SUMMARY_FETCH_LIMIT),
        ["processed_at", "window_end"],
        SUMMARY_RESPONSE_LIMIT,
    )


@app.get("/api/alerts")
def alerts() -> dict[str, Any]:
    return hive_payload(
        "alerts",
        ALERTS_SQL.format(limit=ALERTS_FETCH_LIMIT),
        ["processed_at"],
        ALERTS_RESPONSE_LIMIT,
    )


if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str) -> FileResponse:
    requested_file = STATIC_DIR / path
    if path and requested_file.is_file():
        return FileResponse(requested_file)

    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)

    raise HTTPException(
        status_code=404,
        detail="React dashboard has not been built yet. Run scripts/run-dashboard.sh.",
    )
