import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import Plot from "react-plotly.js";
import { Activity, AlertTriangle, Database, RefreshCw } from "lucide-react";
import "./styles.css";

const DEFAULT_REFRESH_SECONDS = 5;
const SYMBOL_COLORS = {
  BTCUSDT: "#d97706",
  ETHUSDT: "#0284c7",
  SOLUSDT: "#7c3aed",
};

function formatMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(numeric);
}

function formatNumber(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
  }).format(numeric);
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function latestBySymbol(rows) {
  const latest = new Map();
  rows.forEach((row) => {
    const current = latest.get(row.symbol);
    const rowTime = new Date(row.window_end || row.processed_at || 0).getTime();
    const currentTime = current ? new Date(current.window_end || current.processed_at || 0).getTime() : -1;
    if (!current || rowTime >= currentTime) {
      latest.set(row.symbol, row);
    }
  });
  return Array.from(latest.values()).sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)));
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.detail || `Request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function useDashboardData() {
  const [summary, setSummary] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [refreshSeconds, setRefreshSeconds] = useState(DEFAULT_REFRESH_SECONDS);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [waitingForHive, setWaitingForHive] = useState(false);

  useEffect(() => {
    let active = true;
    let timerId;

    async function load() {
      try {
        const [summaryPayload, alertsPayload] = await Promise.all([
          fetchJson("/api/summary"),
          fetchJson("/api/alerts"),
        ]);
        if (!active) return;
        setSummary(summaryPayload.data || []);
        setAlerts(alertsPayload.data || []);
        setRefreshSeconds(summaryPayload.refreshSeconds || DEFAULT_REFRESH_SECONDS);
        setLastUpdated(new Date());
        setError("");
        setWaitingForHive(false);
      } catch (err) {
        if (!active) return;
        if (err.status === 503) {
          setWaitingForHive(true);
          setError("");
        } else {
          setWaitingForHive(false);
          setError("Dashboard data is temporarily unavailable.");
        }
      } finally {
        if (active) {
          setLoading(false);
          timerId = window.setTimeout(load, refreshSeconds * 1000);
        }
      }
    }

    load();
    return () => {
      active = false;
      window.clearTimeout(timerId);
    };
  }, [refreshSeconds]);

  return { summary, alerts, refreshSeconds, lastUpdated, loading, error, waitingForHive };
}

function StatusBar({ error, loading, lastUpdated, waitingForHive }) {
  if (error) {
    return (
      <div className="status status-error">
        <AlertTriangle size={18} />
        <span>{error}</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="status">
        <RefreshCw size={18} className="spin" />
        <span>Loading Hive data...</span>
      </div>
    );
  }

  if (waitingForHive) {
    return (
      <div className="status">
        <RefreshCw size={18} className="spin" />
        <span>Waiting for Hive data...</span>
      </div>
    );
  }

  return (
    <div className="status status-ok">
      <Database size={18} />
      <span>Connected to Hive. Last updated {formatTime(lastUpdated)}.</span>
    </div>
  );
}

function Metrics({ rows }) {
  if (!rows.length) {
    return (
      <section className="empty-panel">
        Waiting for the first Hive data window.
      </section>
    );
  }

  return (
    <section className="metrics-grid">
      {rows.map((row) => (
        <article className="metric-card" key={row.symbol}>
          <div className="metric-topline">
            <span>{row.symbol} average</span>
            <span className="symbol-dot" style={{ background: SYMBOL_COLORS[row.symbol] || "#64748b" }} />
          </div>
          <strong>{formatMoney(row.avg_price)}</strong>
          <small>
            {formatNumber(row.trade_count, 0)} trades | {row.coin_name} | {row.category}
          </small>
        </article>
      ))}
    </section>
  );
}

function LatestTable({ rows }) {
  if (!rows.length) return null;

  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Latest Window</h2>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Name</th>
              <th>Average</th>
              <th>Min</th>
              <th>Max</th>
              <th>Volume</th>
              <th>Trades</th>
              <th>Window End</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.symbol}>
                <td>{row.symbol}</td>
                <td>{row.coin_name}</td>
                <td>{formatMoney(row.avg_price)}</td>
                <td>{formatMoney(row.min_price)}</td>
                <td>{formatMoney(row.max_price)}</td>
                <td>{formatNumber(row.total_volume, 4)}</td>
                <td>{formatNumber(row.trade_count, 0)}</td>
                <td>{formatTime(row.window_end)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function plotLayout(title) {
  return {
    title: { text: title, font: { size: 16 } },
    margin: { l: 48, r: 18, t: 46, b: 42 },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    font: { family: "Inter, system-ui, sans-serif", color: "#1f2937" },
    xaxis: { gridcolor: "#eef2f7" },
    yaxis: { gridcolor: "#eef2f7" },
    showlegend: false,
  };
}

function Charts({ summaryRows, latestRows }) {
  if (!latestRows.length) return null;

  const trendRows = [...summaryRows].sort(
    (a, b) => new Date(a.window_end || 0).getTime() - new Date(b.window_end || 0).getTime(),
  );
  const symbols = Array.from(new Set(trendRows.map((row) => row.symbol))).sort();

  return (
    <section className="charts-grid">
      <div className="chart-panel">
        <Plot
          data={[
            {
              type: "bar",
              x: latestRows.map((row) => row.symbol),
              y: latestRows.map((row) => row.total_volume),
              marker: { color: latestRows.map((row) => SYMBOL_COLORS[row.symbol] || "#64748b") },
              text: latestRows.map((row) => formatNumber(row.total_volume, 4)),
              textposition: "auto",
            },
          ]}
          layout={plotLayout("Latest 10-second Volume")}
          config={{ displayModeBar: false, responsive: true }}
          useResizeHandler
          className="plot"
        />
      </div>
      <div className="chart-panel">
        <Plot
          data={[
            {
              type: "bar",
              x: latestRows.map((row) => row.symbol),
              y: latestRows.map((row) => row.trade_count),
              marker: { color: latestRows.map((row) => SYMBOL_COLORS[row.symbol] || "#64748b") },
              text: latestRows.map((row) => formatNumber(row.trade_count, 0)),
              textposition: "auto",
            },
          ]}
          layout={plotLayout("Latest 10-second Trade Count")}
          config={{ displayModeBar: false, responsive: true }}
          useResizeHandler
          className="plot"
        />
      </div>
      <div className="chart-panel chart-wide">
        <Plot
          data={symbols.map((symbol) => {
            const rows = trendRows.filter((row) => row.symbol === symbol);
            return {
              type: "scatter",
              mode: "lines+markers",
              name: symbol,
              x: rows.map((row) => row.window_end),
              y: rows.map((row) => row.avg_price),
              line: { color: SYMBOL_COLORS[symbol] || "#64748b", width: 2 },
              marker: { size: 6 },
            };
          })}
          layout={{ ...plotLayout("Average Price Trend"), showlegend: true, legend: { orientation: "h" } }}
          config={{ displayModeBar: false, responsive: true }}
          useResizeHandler
          className="plot"
        />
      </div>
    </section>
  );
}

function AlertsTable({ rows }) {
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Alerts</h2>
      </div>
      {!rows.length ? (
        <div className="empty-inline">No alerts yet. Alerts appear when trade activity crosses the configured threshold.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Name</th>
                <th>Type</th>
                <th>Message</th>
                <th>Average</th>
                <th>Processed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.symbol}-${row.processed_at}-${index}`}>
                  <td>{row.symbol}</td>
                  <td>{row.coin_name}</td>
                  <td>{row.alert_type}</td>
                  <td>{row.alert_message}</td>
                  <td>{formatMoney(row.current_avg_price)}</td>
                  <td>{formatTime(row.processed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function App() {
  const { summary, alerts, refreshSeconds, lastUpdated, loading, error, waitingForHive } = useDashboardData();
  const latestRows = useMemo(() => latestBySymbol(summary), [summary]);

  return (
    <main className="dashboard">
      <header className="topbar">
        <div>
          <h1>CS523 Big data project</h1>
          <p>Coinbase/Binance &rarr; Kafka &rarr; Spark Structured Streaming &rarr; Hive</p>
        </div>
        <div className="refresh-pill">
          <Activity size={16} />
          <span>Live refresh: {refreshSeconds}s</span>
        </div>
      </header>

      <StatusBar error={error} loading={loading} lastUpdated={lastUpdated} waitingForHive={waitingForHive} />
      <Metrics rows={latestRows} />
      <LatestTable rows={latestRows} />
      <Charts summaryRows={summary} latestRows={latestRows} />
      <AlertsTable rows={alerts} />
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
