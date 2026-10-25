const $ = (id) => document.getElementById(id);
const money = (n) => (n == null ? "–" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const pct = (n) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const when = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const sign = (n) => (n > 0 ? "up" : n < 0 ? "down" : "");

let state = null;

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.status === 401) { location.href = "/login"; throw new Error("Please log in."); }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2500);
}

function render() {
  const s = state.settings;
  const start = s.startingCash;
  const pnl = state.totalValue - start;
  $("engine").textContent = state.claudeEnabled ? `· Decisions by Claude` : "· Backup strategy (no API key)";
  $("value").textContent = money(state.totalValue);
  $("pnl").innerHTML = `<span class="${sign(pnl)}">${money(pnl)} <small>(${pct((pnl / start) * 100)})</small></span>`;
  $("cash").textContent = money(state.cash);
  $("marketStatus").textContent = s.dataProvider === "demo" ? "Demo prices" : state.marketOpen ? "US market open" : "US market closed";
  $("runBtn").disabled = state.running;
  $("runBtn").textContent = state.running ? "Thinking…" : "Run analysis";
  renderChart();
  renderLastRun();
  renderHoldings();
  renderTrades();
  fillSettings();
}

function renderChart() {
  const pts = [{ value: state.settings.startingCash }, ...state.history];
  const svg = $("chart");
  $("chartEmpty").hidden = state.history.length > 0;
  svg.style.display = state.history.length ? "block" : "none";
  if (!state.history.length) return;
  const vals = pts.map((p) => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const pad = (max - min) * 0.1 || max * 0.01 || 1;
  const lo = min - pad, hi = max + pad;
  const x = (i) => (pts.length === 1 ? 300 : (i / (pts.length - 1)) * 600);
  const y = (v) => 160 - ((v - lo) / (hi - lo)) * 160;
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const color = vals.at(-1) >= vals[0] ? "var(--up)" : "var(--down)";
  svg.innerHTML = `
    <line x1="0" x2="600" y1="${y(vals[0])}" y2="${y(vals[0])}" stroke="var(--line)" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>
    <path d="${line} L600,160 L0,160 Z" fill="${color}" opacity="0.08"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
}

function renderLastRun() {
  const run = state.runs[0];
  if (!run) return;
  const executed = run.executed.length
    ? run.executed.map(tradeHtml).join("")
    : `<p class="muted">No trades this run.</p>`;
  const blocked = run.rejected.length
    ? `<h3 class="small">Blocked or trimmed by safety rules</h3><ul class="small">${run.rejected.map((r) => `<li><b>${esc(r.action)} ${esc(r.shares)} ${esc(r.symbol)}</b>: ${esc(r.why)}</li>`).join("")}</ul>`
    : "";
  const holds = run.decisions.filter((d) => d.action === "hold");
  const holdList = holds.length
    ? `<details class="small"><summary>Holding ${holds.length} stock${holds.length > 1 ? "s" : ""}: see why</summary><ul>${holds.map((d) => `<li><b>${esc(d.symbol)}</b>: ${esc(d.reason)}</li>`).join("")}</ul></details>`
    : "";
  const errors = run.errors.length ? `<ul class="err small">${run.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : "";
  $("lastRun").innerHTML = `
    <div class="row"><h2>Latest decision</h2><span class="muted small">${when(run.time)} · ${esc(run.engine || "")}${run.trigger === "auto" ? " · auto" : ""}</span></div>
    ${run.marketView ? `<div class="view">${esc(run.marketView)}</div>` : ""}
    ${errors}${executed}${blocked}${holdList}`;
}

function renderHoldings() {
  const rows = Object.entries(state.positions);
  if (!rows.length) { $("holdings").innerHTML = `<p class="muted">All cash. Nothing owned yet.</p>`; return; }
  $("holdings").innerHTML = `<div class="scroll"><table>
    <tr><th>Stock</th><th class="num">Shares</th><th class="num">Avg cost</th><th class="num">Price</th><th class="num">Gain</th></tr>
    ${rows.map(([sym, p]) => {
      const price = state.lastPrices[sym] ?? p.avgCost;
      const gain = (price - p.avgCost) * p.shares;
      return `<tr><td><b>${esc(sym)}</b></td><td class="num">${p.shares}</td><td class="num">${money(p.avgCost)}</td><td class="num">${money(price)}</td>
        <td class="num ${sign(gain)}">${money(gain)}<br><small>${pct(((price - p.avgCost) / p.avgCost) * 100)}</small></td></tr>`;
    }).join("")}
  </table></div>`;
}

function tradeHtml(t) {
  const who = { claude: "Claude", strategy: "Backup strategy", "stop-loss": "Stop-loss rule" }[t.source] || t.source;
  const conf = t.confidence != null ? ` · ${Math.round(t.confidence * 100)}% confident` : "";
  const realized = t.realizedPnl != null ? ` · <span class="${sign(t.realizedPnl)}">${money(t.realizedPnl)} realized</span>` : "";
  return `<div class="trade">
    <div class="row"><span><span class="tag ${t.side}">${t.side}</span> <b>${t.shares} ${esc(t.symbol)}</b> @ ${money(t.price)}</span>
      <button class="copy" data-copy="${esc(`${t.side === "buy" ? "Buy" : "Sell"} ${t.shares} shares of ${t.symbol} (market order)`)}">Copy</button></div>
    <p class="reason">${esc(t.reason)}</p>
    <span class="muted small">${when(t.time)} · ${who}${conf}${realized}</span>
  </div>`;
}

function renderTrades() {
  $("trades").innerHTML = state.trades.length ? state.trades.slice(0, 50).map(tradeHtml).join("") : `<p class="muted">No trades yet.</p>`;
}

let settingsFilled = false;
function fillSettings() {
  if (settingsFilled) return;
  settingsFilled = true;
  const f = $("settings"), s = state.settings;
  f.watchlist.value = s.watchlist.join(", ");
  for (const k of ["dataProvider", "maxPositionPct", "minCashPct", "stopLossPct", "maxTradesPerRun", "autoRunMinutes", "startingCash"]) f[k].value = s[k];
  f.useNewsSearch.checked = s.useNewsSearch;
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("button.copy");
  if (!btn) return;
  try { await navigator.clipboard.writeText(btn.dataset.copy); toast("Copied: " + btn.dataset.copy); }
  catch { toast(btn.dataset.copy); }
});

$("runBtn").addEventListener("click", async () => {
  state.running = true; render();
  try {
    const { run, state: next } = await api("/api/run", {});
    state = next;
    toast(run.executed.length ? `${run.executed.length} trade${run.executed.length > 1 ? "s" : ""} made` : "No trades this time");
  } catch (err) {
    toast(err.message);
    state = await api("/api/state");
  }
  render();
});

$("settings").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {
    watchlist: f.watchlist.value.split(/[\s,]+/).filter(Boolean),
    dataProvider: f.dataProvider.value,
    useNewsSearch: f.useNewsSearch.checked,
  };
  for (const k of ["maxPositionPct", "minCashPct", "stopLossPct", "maxTradesPerRun", "autoRunMinutes", "startingCash"]) body[k] = Number(f[k].value);
  state = await api("/api/settings", body);
  settingsFilled = false;
  render();
  $("settingsMsg").textContent = "Saved.";
});

$("resetBtn").addEventListener("click", async () => {
  if (!confirm("Reset the practice portfolio? All holdings and history will be erased.")) return;
  try { state = await api("/api/reset", {}); render(); toast("Portfolio reset"); }
  catch (err) { toast(err.message); }
});

async function refresh() {
  try { state = await api("/api/state"); render(); } catch { /* server restarting */ }
}
refresh();
setInterval(refresh, 30000);
