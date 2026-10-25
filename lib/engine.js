// One analysis run: prices -> stop-losses -> trade ideas -> safety rules -> trades.
// Shared by the web server and the GitHub Actions runner.
import Anthropic from "@anthropic-ai/sdk";
import { totalValue, executeOrder } from "./portfolio.js";
import { getMarketData, isMarketOpen } from "./market.js";
import { stopLossOrders, checkDecisions } from "./rules.js";
import { claudeDecide, strategyDecide, hasClaude, MODEL } from "./brain.js";

export async function runAnalysis(state, trigger = "manual") {
  const s = state.settings;
  const run = { time: new Date().toISOString(), trigger, engine: null, priceSource: null, marketView: "", decisions: [], executed: [], rejected: [], errors: [] };
  try {
    const market = await getMarketData(s.watchlist, s.dataProvider);
    for (const m of market) if (m.error) run.errors.push(`${m.symbol}: ${m.error}`);
    const good = market.filter((m) => m.price);
    if (!good.length) throw new Error("Couldn't get prices for any watchlist stock.");
    run.priceSource = [...new Set(good.map((m) => m.source))].join(", ");
    const prices = Object.fromEntries(good.map((m) => [m.symbol, m.price]));
    state.lastPrices = { ...state.lastPrices, ...prices };
    const forClaude = good.map(({ source, ...rest }) => rest);

    // 1. Safety first: stop-losses run before anything else.
    const stops = stopLossOrders(state, prices, s);
    for (const o of stops) run.executed.push(executeOrder(state, o));

    // 2. Get trade ideas.
    let ideas;
    if (hasClaude()) {
      try {
        ideas = await claudeDecide(state, forClaude);
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
      ideas = strategyDecide(state, forClaude);
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
  }
  return run;
}

export function publicView(state, extra = {}) {
  return {
    ...state,
    totalValue: totalValue(state),
    claudeEnabled: hasClaude(),
    model: hasClaude() ? MODEL : null,
    marketOpen: isMarketOpen(),
    ...extra,
  };
}

// Clean up settings from the web form or settings.json. Bad values are ignored.
export function applySettings(s, input = {}) {
  const num = (v, min, max) => {
    const n = Number(v);
    return v !== "" && v != null && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
  };
  if (Array.isArray(input.watchlist)) {
    const list = [...new Set(input.watchlist.map((x) => String(x).trim().toUpperCase()).filter((x) => /^[A-Z.\-^]{1,10}$/.test(x)))];
    if (list.length) s.watchlist = list.slice(0, 25);
  }
  if (["yahoo", "real"].includes(input.dataProvider)) s.dataProvider = "yahoo"; // "yahoo" = real prices (Alpaca when keys are set)
  if (input.dataProvider === "demo") s.dataProvider = "demo";
  for (const [key, min, max] of [["maxPositionPct", 1, 100], ["minCashPct", 0, 90], ["stopLossPct", 1, 50], ["maxTradesPerRun", 1, 25], ["autoRunMinutes", 0, 1440], ["startingCash", 100, 1e9]]) {
    const v = num(input[key], min, max);
    if (v !== undefined) s[key] = key === "maxTradesPerRun" || key === "autoRunMinutes" ? Math.round(v) : v;
  }
  if (typeof input.useNewsSearch === "boolean") s.useNewsSearch = input.useNewsSearch;
  return s;
}
