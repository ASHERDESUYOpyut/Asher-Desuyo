import { test } from "node:test";
import assert from "node:assert/strict";
import { newState, executeOrder, totalValue, DEFAULT_SETTINGS } from "../lib/portfolio.js";
import { checkDecisions, stopLossOrders } from "../lib/rules.js";
import { rsi, sma, summarize } from "../lib/market.js";

const settings = { ...DEFAULT_SETTINGS, watchlist: ["AAPL", "MSFT"], startingCash: 10000 };
const buy = (symbol, shares, confidence = 0.8) => ({ symbol, action: "buy", shares, confidence, reason: "test", source: "claude" });
const sell = (symbol, shares) => ({ symbol, action: "sell", shares, confidence: 0.8, reason: "test", source: "claude" });

test("buys are trimmed to the max position size", () => {
  const state = newState(settings);
  const { approved } = checkDecisions(state, [buy("AAPL", 100)], { AAPL: 100 }, settings);
  assert.equal(approved[0].shares, 10); // 10% of $10,000 = $1,000 = 10 shares
  assert.match(approved[0].ruleNote, /position size/);
});

test("cash reserve is kept", () => {
  const s = { ...settings, maxPositionPct: 100, minCashPct: 50 };
  const state = newState(s);
  const { approved } = checkDecisions(state, [buy("AAPL", 100)], { AAPL: 100 }, s);
  assert.equal(approved[0].shares, 50);
});

test("blocks unknown symbols, short sells and too many trades", () => {
  const s = { ...settings, maxTradesPerRun: 1 };
  const state = newState(s);
  const { approved, rejected } = checkDecisions(state, [buy("TSLA", 1), sell("AAPL", 1), buy("AAPL", 1), buy("MSFT", 1, 0.1)], { AAPL: 100, MSFT: 100, TSLA: 100 }, s);
  assert.deepEqual(approved.map((o) => o.symbol), ["AAPL"]);
  assert.deepEqual(rejected.map((r) => r.why.slice(0, 12)).sort(), ["Not on your ", "Over the lim", "We don't own"].sort());
});

test("sells are capped at shares owned and update cash", () => {
  const state = newState(settings);
  executeOrder(state, { symbol: "AAPL", side: "buy", shares: 5, price: 100, reason: "x", source: "claude" });
  const { approved } = checkDecisions(state, [sell("AAPL", 50)], { AAPL: 120 }, settings);
  assert.equal(approved[0].shares, 5);
  const trade = executeOrder(state, approved[0]);
  assert.equal(trade.realizedPnl, 100);
  assert.equal(state.cash, 10100);
  assert.equal(state.positions.AAPL, undefined);
});

test("stop-loss sells positions that dropped too far", () => {
  const state = newState(settings);
  executeOrder(state, { symbol: "AAPL", side: "buy", shares: 5, price: 100, reason: "x", source: "claude" });
  assert.equal(stopLossOrders(state, { AAPL: 95 }, settings).length, 0);
  const orders = stopLossOrders(state, { AAPL: 91 }, settings);
  assert.equal(orders[0].shares, 5);
  assert.equal(orders[0].source, "stop-loss");
});

test("portfolio value and averages", () => {
  const state = newState(settings);
  executeOrder(state, { symbol: "AAPL", side: "buy", shares: 2, price: 100, reason: "x", source: "claude" });
  executeOrder(state, { symbol: "AAPL", side: "buy", shares: 2, price: 200, reason: "x", source: "claude" });
  assert.equal(state.positions.AAPL.avgCost, 150);
  assert.equal(totalValue(state, { AAPL: 150 }), 10000);
});

test("indicators", () => {
  assert.equal(sma([1, 2, 3, 4], 2), 3.5);
  assert.equal(rsi([1, 2, 3, 4, 5], 4), 100);
  const s = summarize([10, 11, 12].map((close) => ({ close })));
  assert.equal(s.price, 12);
  assert.equal(s.change1dPct, 9.09);
});
