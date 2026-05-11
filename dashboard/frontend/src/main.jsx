import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import Plot from "react-plotly.js";
import { Activity, AlertTriangle, ChevronLeft, ChevronRight, Database, RefreshCw, Search } from "lucide-react";
import "./styles.css";

const DEFAULT_REFRESH_SECONDS = 5;
const SYMBOL_COLORS = {
  BTCUSDT: "#d97706",
  ETHUSDT: "#0284c7",
  SOLUSDT: "#7c3aed",
};
const ALERT_PAGE_SIZE = 10;

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

function formatPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(2)}%`;
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function extractTradeCount(message) {
  const match = String(message || "").match(/(\d+)\s+trades/i);
  return match ? Number(match[1]) : null;
}

function humanizeAlertType(value) {
  return String(value || "")
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
    hovermode: "x unified",
    showlegend: false,
  };
}

function Charts({ summaryRows, latestRows }) {
  const [priceMode, setPriceMode] = useState("change");

  if (!latestRows.length) return null;

  const trendRows = [...summaryRows].sort(
    (a, b) => new Date(a.window_end || 0).getTime() - new Date(b.window_end || 0).getTime(),
  );
  const symbols = Array.from(new Set(trendRows.map((row) => row.symbol))).sort();
  const latestByTrendSymbol = latestBySymbol(trendRows);
  const isChangeMode = priceMode === "change";
  const priceLayout = {
    ...plotLayout(isChangeMode ? "Average Price Change" : "Average Price Trend"),
    showlegend: true,
    legend: { orientation: "h", y: -0.18 },
    yaxis: {
      gridcolor: "#eef2f7",
      tickformat: isChangeMode ? "+.1f" : "$,.0f",
      ticksuffix: isChangeMode ? "%" : "",
      zeroline: true,
      zerolinecolor: "#cbd5e1",
    },
  };

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
        <div className="chart-toolbar">
          <div>
            <h2>Price Movement</h2>
            <p>{isChangeMode ? "Compare symbols on the same percent-change scale." : "Show raw average prices in USD."}</p>
          </div>
          <div className="segmented-control" aria-label="Price chart mode">
            <button className={priceMode === "change" ? "active" : ""} type="button" onClick={() => setPriceMode("change")}>
              Change %
            </button>
            <button className={priceMode === "absolute" ? "active" : ""} type="button" onClick={() => setPriceMode("absolute")}>
              USD
            </button>
          </div>
        </div>
        <div className="trend-summary">
          {latestByTrendSymbol.map((row) => {
            const symbolRows = trendRows.filter((item) => item.symbol === row.symbol);
            const first = Number(symbolRows[0]?.avg_price);
            const latest = Number(row.avg_price);
            const change = Number.isFinite(first) && first !== 0 ? ((latest - first) / first) * 100 : null;
            return (
              <div className="trend-chip" key={row.symbol}>
                <span className="symbol-dot" style={{ background: SYMBOL_COLORS[row.symbol] || "#64748b" }} />
                <strong>{row.symbol}</strong>
                <span>{formatMoney(latest)}</span>
                <em className={change >= 0 ? "positive" : "negative"}>{formatPercent(change)}</em>
              </div>
            );
          })}
        </div>
        <Plot
          data={symbols.map((symbol) => {
            const rows = trendRows.filter((row) => row.symbol === symbol);
            const firstPrice = Number(rows[0]?.avg_price);
            const yValues = isChangeMode
              ? rows.map((row) => {
                  const price = Number(row.avg_price);
                  return Number.isFinite(price) && Number.isFinite(firstPrice) && firstPrice !== 0
                    ? ((price - firstPrice) / firstPrice) * 100
                    : null;
                })
              : rows.map((row) => row.avg_price);
            return {
              type: "scatter",
              mode: "lines+markers",
              name: symbol,
              x: rows.map((row) => row.window_end),
              y: yValues,
              line: { color: SYMBOL_COLORS[symbol] || "#64748b", width: 2 },
              marker: { size: 6 },
              customdata: rows.map((row, index) => [formatMoney(row.avg_price), formatPercent(yValues[index])]),
              hovertemplate: isChangeMode
                ? "%{fullData.name}<br>%{customdata[1]}<br>%{customdata[0]}<extra></extra>"
                : "%{fullData.name}<br>%{customdata[0]}<extra></extra>",
            };
          })}
          layout={priceLayout}
          config={{ displayModeBar: false, responsive: true }}
          useResizeHandler
          className="plot"
        />
      </div>
    </section>
  );
}

function AlertsTable({ rows }) {
  const [symbolFilter, setSymbolFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const symbols = useMemo(() => Array.from(new Set(rows.map((row) => row.symbol))).sort(), [rows]);
  const enrichedRows = useMemo(
    () =>
      rows.map((row, index) => ({
        ...row,
        id: `${row.symbol}-${row.processed_at}-${index}`,
        tradeCount: extractTradeCount(row.alert_message),
      })),
    [rows],
  );
  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return enrichedRows.filter((row) => {
      const matchesSymbol = symbolFilter === "all" || row.symbol === symbolFilter;
      const matchesQuery =
        !normalizedQuery ||
        [row.symbol, row.coin_name, row.alert_type, row.alert_message]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery));
      return matchesSymbol && matchesQuery;
    });
  }, [enrichedRows, query, symbolFilter]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ALERT_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((currentPage - 1) * ALERT_PAGE_SIZE, currentPage * ALERT_PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [symbolFilter, query]);

  return (
    <section className="panel">
      <div className="section-heading table-heading">
        <div>
          <h2>Alerts</h2>
          <p>{rows.length ? `${filteredRows.length} matching alerts from the latest ${rows.length} records` : "No alerts yet"}</p>
        </div>
        <div className="alert-controls">
          <label className="select-control">
            <span>Symbol</span>
            <select value={symbolFilter} onChange={(event) => setSymbolFilter(event.target.value)}>
              <option value="all">All</option>
              {symbols.map((symbol) => (
                <option value={symbol} key={symbol}>
                  {symbol}
                </option>
              ))}
            </select>
          </label>
          <label className="search-control">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search alerts"
              type="search"
            />
          </label>
        </div>
      </div>
      {!rows.length ? (
        <div className="empty-inline">No alerts yet. Alerts appear when trade activity crosses the configured threshold.</div>
      ) : (
        <>
          <div className="table-wrap alerts-wrap">
            <table className="alerts-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Symbol</th>
                  <th>Coin</th>
                  <th>Alert</th>
                  <th>Trades</th>
                  <th>Avg Price</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.processed_at)}</td>
                    <td>
                      <span className="symbol-cell">
                        <span className="symbol-dot" style={{ background: SYMBOL_COLORS[row.symbol] || "#64748b" }} />
                        {row.symbol}
                      </span>
                    </td>
                    <td>{row.coin_name}</td>
                    <td>
                      <span className="alert-badge">{humanizeAlertType(row.alert_type)}</span>
                    </td>
                    <td>{formatNumber(row.tradeCount, 0)}</td>
                    <td>{formatMoney(row.current_avg_price)}</td>
                    <td className="detail-cell">{row.alert_message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!pageRows.length ? <div className="empty-inline">No alerts match the current filters.</div> : null}
          </div>
          <div className="pagination">
            <span>
              Page {currentPage} of {totalPages}
            </span>
            <div>
              <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1}>
                <ChevronLeft size={16} />
                Prev
              </button>
              <button
                type="button"
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                disabled={currentPage === totalPages}
              >
                Next
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </>
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
