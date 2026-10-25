// Where trade ideas come from: Claude (when an API key is set) or a simple
// moving-average strategy as a backup.
import Anthropic from "@anthropic-ai/sdk";
import { totalValue } from "./portfolio.js";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

const DECISION_SCHEMA = {
  type: "object",
  properties: {
    market_view: { type: "string", description: "2-4 sentences on overall market conditions and your stance." },
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          action: { type: "string", enum: ["buy", "sell", "hold"] },
          shares: { type: "integer", description: "Whole shares to buy or sell. 0 for hold." },
          confidence: { type: "number", description: "0 to 1." },
          reason: { type: "string", description: "One or two plain-English sentences." },
        },
        required: ["symbol", "action", "shares", "confidence", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["market_view", "decisions"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You manage a practice (paper-money) US stock portfolio. Each run you get the current portfolio, recent price data and indicators for every stock on the watchlist, and your recent trades. Decide whether to buy, sell or hold each watchlist stock.

How to decide:
- Aim for steady risk-adjusted growth, not big bets. Holding is a fine answer; trade only when you have a clear reason.
- Weigh trend (price vs. 20- and 50-day averages), momentum (RSI, recent % changes), how concentrated the portfolio already is, and any recent news you find.
- Avoid churning: don't reverse a recent trade unless something has clearly changed.
- Share counts must be whole numbers sized with the rules below in mind.

Hard rules the system enforces after you answer (trades that break them get trimmed or blocked):
- Only stocks on the watchlist. No short selling, options or margin.
- No single stock above the max position % of total portfolio value.
- Cash never drops below the minimum cash %.
- At most the max trades per run (holds don't count).
- Holdings that fall past the stop-loss % below average cost are sold automatically.

Return exactly one decision per watchlist stock. Keep reasons short and in plain English for a non-expert.`;

let client = null;
export function hasClaude() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
function getClient() {
  client ??= new Anthropic();
  return client;
}

export async function claudeDecide(state, market) {
  const s = state.settings;
  const prices = Object.fromEntries(market.filter((m) => m.price).map((m) => [m.symbol, m.price]));
  const value = totalValue(state, prices);
  const payload = {
    now: new Date().toISOString(),
    rules: {
      maxPositionPct: s.maxPositionPct, minCashPct: s.minCashPct,
      stopLossPct: s.stopLossPct, maxTradesPerRun: s.maxTradesPerRun,
    },
    portfolio: {
      totalValue: Math.round(value * 100) / 100,
      cash: Math.round(state.cash * 100) / 100,
      positions: Object.entries(state.positions).map(([symbol, p]) => ({
        symbol, shares: p.shares, avgCost: Math.round(p.avgCost * 100) / 100,
        currentPrice: prices[symbol] ?? null,
        pctOfPortfolio: prices[symbol] ? Math.round(((p.shares * prices[symbol]) / value) * 1000) / 10 : null,
      })),
    },
    watchlist: market,
    recentTrades: state.trades.slice(0, 15).map(({ time, symbol, side, shares, price, source }) => ({ time, symbol, side, shares, price, source })),
  };

  const tools = s.useNewsSearch && s.dataProvider !== "demo"
    ? [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }]
    : [];
  const userText = `${tools.length ? "Search for important recent news on these stocks and the market before deciding. " : ""}Here is today's data:\n\n${JSON.stringify(payload, null, 2)}`;
  const messages = [{ role: "user", content: userText }];

  let response;
  // Web search can pause a long turn; continue it a few times if so.
  for (let attempt = 0; attempt < 4; attempt++) {
    response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // if Claude declines, retry on Anthropic's recommended backup model
      output_config: { effort: "high", format: { type: "json_schema", schema: DECISION_SCHEMA } },
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }

  if (response.stop_reason === "refusal") throw new Error("Claude declined this request.");
  if (response.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off. Try again with a shorter watchlist.");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Claude's answer wasn't in the expected format.");
  }
  if (!Array.isArray(parsed.decisions)) throw new Error("Claude's answer had no decisions.");
  return {
    marketView: String(parsed.market_view ?? ""),
    decisions: parsed.decisions.map((d) => ({ ...d, source: "claude" })),
    model: response.model,
    usage: { input: response.usage?.input_tokens, output: response.usage?.output_tokens },
  };
}

// Backup when there's no API key: buy when the 20-day average is above the
// 50-day (uptrend) and RSI isn't overheated; sell when the trend turns down.
export function strategyDecide(state, market) {
  const value = totalValue(state, Object.fromEntries(market.filter((m) => m.price).map((m) => [m.symbol, m.price])));
  const decisions = market.filter((m) => m.price).map((m) => {
    const held = state.positions[m.symbol]?.shares ?? 0;
    const up = m.sma20 != null && m.sma50 != null && m.sma20 > m.sma50;
    if (!held && up && m.rsi14 < 70) {
      const shares = Math.floor((value * (state.settings.maxPositionPct / 100) * 0.9) / m.price);
      return { symbol: m.symbol, action: "buy", shares, confidence: 0.6, reason: `Uptrend: 20-day average ($${m.sma20}) is above the 50-day ($${m.sma50}) and RSI ${m.rsi14} isn't overheated.` };
    }
    if (held && m.sma20 != null && m.sma50 != null && m.sma20 < m.sma50) {
      return { symbol: m.symbol, action: "sell", shares: held, confidence: 0.6, reason: `Trend turned down: 20-day average ($${m.sma20}) fell below the 50-day ($${m.sma50}).` };
    }
    return { symbol: m.symbol, action: "hold", shares: 0, confidence: 0.5, reason: held ? "Uptrend still intact." : "No clear uptrend yet." };
  });
  return { marketView: "Backup strategy (no Claude API key set): simple moving-average trend following.", decisions: decisions.map((d) => ({ ...d, source: "strategy" })) };
}
