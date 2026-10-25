import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { Store, totalValue, executeOrder, DEFAULT_SETTINGS } from "./lib/portfolio.js";
import { getMarketData, isMarketOpen } from "./lib/market.js";
import { stopLossOrders, checkDecisions } from "./lib/rules.js";
import { claudeDecide, strategyDecide, hasClaude, MODEL } from "./lib/brain.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const store = new Store(process.env.DATA_FILE || path.join(here, "data", "portfolio.json"));
const app = express();
app.use(express.json());

// Optional password so strangers can't run trades (and spend API credit) if this is online.
if (process.env.APP_PASSWORD) {
  app.use((req, res, next) => {
    const [, encoded] = (req.headers.authorization || "").split(" ");
    const password = encoded ? Buffer.from(encoded, "base64").toString().split(":").slice(1).join(":") : "";
    if (password === process.env.APP_PASSWORD) return next();
    res.set("WWW-Authenticate", 'Basic realm="AI Trader"').status(401).send("Password required");
  });
}
app.use(express.static(path.join(here, "public")));

let running = false;

export async function runOnce(trigger = "manual") {
  if (running) throw new Error("A run is already in progress.");
  running = true;
  const state = store.state;
  const s = state.settings;
  const run = { time: new Date().toISOString(), trigger, engine: null, marketView: "", decisions: [], executed: [], rejected: [], errors: [] };
  try {
    const market = await getMarketData(s.watchlist, s.dataProvider);
    for (const m of market) if (m.error) run.errors.push(`${m.symbol}: ${m.error}`);
    const good = market.filter((m) => m.price);
    if (!good.length) throw new Error("Couldn't get prices for any watchlist stock.");
    const prices = Object.fromEntries(good.map((m) => [m.symbol, m.price]));
    state.lastPrices = { ...state.lastPrices, ...prices };

    // 1. Safety first: stop-losses run before anything else.
    const stops = stopLossOrders(state, prices, s);
    for (const o of stops) run.executed.push(executeOrder(state, o));

    // 2. Get trade ideas.
    let ideas;
    if (hasClaude()) {
      try {
        ideas = await claudeDecide(state, good);
        run.engine = `Claude (${ideas.model})`;
      } catch (err) {
        const why = err instanceof Anthropic.AuthenticationError ? "the API key was rejected"
          : err instanceof Anthropic.RateLimitError ? "rate limited, try again shortly"
          : err instanceof Anthropic.APIError ? `API error ${err.status ?? ""}`.trim()
          : err.message;
        run.errors.push(`Claude unavailable (${why}). No trades were made this run.`);
        ideas = { marketView: "", decisions: [] };
        run.engine = "Claude (failed)";
      }
    } else {
      ideas = strategyDecide(state, good);
      run.engine = "Backup strategy";
    }
    run.marketView = ideas.marketView;
    run.decisions = ideas.decisions;

    // 3. Rules check, then execute what's allowed.
    const { approved, rejected } = checkDecisions(state, ideas.decisions, prices, s, stops.map((o) => o.symbol));
    for (const o of approved) {
      const reason = o.ruleNote ? `${o.reason} (Rules: ${o.ruleNote}.)` : o.reason;
      run.executed.push(executeOrder(state, { ...o, reason }));
    }
    run.rejected = rejected;
    state.history.push({ time: run.time, value: Math.round(totalValue(state) * 100) / 100 });
    state.history = state.history.slice(-2000);
  } catch (err) {
    run.errors.push(err.message);
  } finally {
    state.runs.unshift(run);
    state.runs = state.runs.slice(0, 50);
    store.save();
    running = false;
  }
  return run;
}

function publicState() {
  const st = store.state;
  return {
    ...st,
    totalValue: totalValue(st),
    running,
    claudeEnabled: hasClaude(),
    model: hasClaude() ? MODEL : null,
    marketOpen: isMarketOpen(),
  };
}

app.get("/api/state", (req, res) => res.json(publicState()));

app.post("/api/run", async (req, res) => {
  try {
    const run = await runOnce("manual");
    res.json({ run, state: publicState() });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

app.post("/api/settings", (req, res) => {
  const input = req.body || {};
  const s = store.state.settings;
  const num = (v, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
  };
  if (Array.isArray(input.watchlist)) {
    const list = [...new Set(input.watchlist.map((x) => String(x).trim().toUpperCase()).filter((x) => /^[A-Z.\-^]{1,10}$/.test(x)))];
    if (list.length) s.watchlist = list.slice(0, 25);
  }
  if (["yahoo", "demo"].includes(input.dataProvider)) s.dataProvider = input.dataProvider;
  for (const [key, min, max] of [["maxPositionPct", 1, 100], ["minCashPct", 0, 90], ["stopLossPct", 1, 50], ["maxTradesPerRun", 1, 25], ["autoRunMinutes", 0, 1440], ["startingCash", 100, 1e9]]) {
    const v = num(input[key], min, max);
    if (v !== undefined) s[key] = key === "maxTradesPerRun" || key === "autoRunMinutes" ? Math.round(v) : v;
  }
  if (typeof input.useNewsSearch === "boolean") s.useNewsSearch = input.useNewsSearch;
  store.save();
  scheduleAutoRun();
  res.json(publicState());
});

app.post("/api/reset", (req, res) => {
  if (running) return res.status(409).json({ error: "Wait for the current run to finish." });
  store.reset();
  res.json(publicState());
});

// Auto-run on a timer, only while the US market is open (demo prices run any time).
let timer = null;
function scheduleAutoRun() {
  clearInterval(timer);
  const minutes = store.state.settings.autoRunMinutes;
  if (!minutes) return;
  timer = setInterval(() => {
    const s = store.state.settings;
    if (running || (s.dataProvider !== "demo" && !isMarketOpen())) return;
    runOnce("auto").catch(() => {});
  }, minutes * 60 * 1000);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  scheduleAutoRun();
  app.listen(port, () => {
    console.log(`AI Trader running at http://localhost:${port}`);
    console.log(hasClaude() ? `Decisions by Claude (${MODEL}).` : "No ANTHROPIC_API_KEY set: using the backup strategy.");
  });
}

export { app, store, DEFAULT_SETTINGS };
