// Safety rules. Every trade idea, from Claude or the backup strategy, passes
// through here. The rules can shrink or block a trade but never add one.
import { totalValue } from "./portfolio.js";

// Holdings that fell too far below what we paid get sold, no questions asked.
export function stopLossOrders(state, prices, settings) {
  const orders = [];
  for (const [symbol, pos] of Object.entries(state.positions)) {
    const price = prices[symbol];
    if (!price) continue;
    const dropPct = ((pos.avgCost - price) / pos.avgCost) * 100;
    if (dropPct >= settings.stopLossPct) {
      orders.push({
        symbol, side: "sell", shares: pos.shares, price, source: "stop-loss",
        reason: `Stop-loss: down ${dropPct.toFixed(1)}% from average cost $${pos.avgCost.toFixed(2)} (limit ${settings.stopLossPct}%).`,
      });
    }
  }
  return orders;
}

// Turn trade ideas into allowed orders. Returns { approved, rejected }.
// `alreadySold` lists symbols the stop-loss already closed this run.
export function checkDecisions(state, decisions, prices, settings, alreadySold = []) {
  const approved = [];
  const rejected = [];
  const watch = new Set(settings.watchlist.map((s) => s.toUpperCase()));
  const portfolioValue = totalValue(state, prices);
  let cash = state.cash;
  const held = Object.fromEntries(Object.entries(state.positions).map(([s, p]) => [s, p.shares]));

  const ideas = decisions
    .filter((d) => d.action !== "hold")
    .map((d) => ({ ...d, symbol: String(d.symbol).toUpperCase(), shares: Math.floor(Number(d.shares)) }));
  // Sells first so their cash is available, then the most confident buys.
  ideas.sort((a, b) => (a.action === b.action ? (b.confidence ?? 0) - (a.confidence ?? 0) : a.action === "sell" ? -1 : 1));

  const reject = (d, why) => rejected.push({ symbol: d.symbol, action: d.action, shares: d.shares, why });

  for (const d of ideas) {
    if (approved.length >= settings.maxTradesPerRun) { reject(d, `Over the limit of ${settings.maxTradesPerRun} trades per run.`); continue; }
    if (!watch.has(d.symbol)) { reject(d, "Not on your watchlist."); continue; }
    if (alreadySold.includes(d.symbol)) { reject(d, "Already sold by the stop-loss this run."); continue; }
    const price = prices[d.symbol];
    if (!price) { reject(d, "No current price available."); continue; }
    if (!(d.shares > 0)) { reject(d, "Share count must be a whole number above zero."); continue; }

    const order = { symbol: d.symbol, side: d.action, price, reason: d.reason, source: d.source, confidence: d.confidence };
    let shares = d.shares;
    const notes = [];

    if (d.action === "sell") {
      const have = held[d.symbol] ?? 0;
      if (have === 0) { reject(d, "We don't own any shares (no short selling)."); continue; }
      if (shares > have) { shares = have; notes.push(`trimmed to the ${have} shares we own`); }
      held[d.symbol] = have - shares;
      cash += shares * price;
    } else if (d.action === "buy") {
      const maxPositionValue = (settings.maxPositionPct / 100) * portfolioValue;
      const currentValue = (held[d.symbol] ?? 0) * price;
      const roomByPosition = Math.floor((maxPositionValue - currentValue) / price);
      const roomByCash = Math.floor((cash - (settings.minCashPct / 100) * portfolioValue) / price);
      const room = Math.max(0, Math.min(roomByPosition, roomByCash));
      if (room === 0) {
        reject(d, roomByPosition <= 0 ? `Position already at the ${settings.maxPositionPct}% size limit.` : `Would drop cash below the ${settings.minCashPct}% minimum.`);
        continue;
      }
      if (shares > room) {
        notes.push(`trimmed from ${shares} to ${room} shares by the ${roomByPosition <= roomByCash ? "position size" : "cash reserve"} rule`);
        shares = room;
      }
      held[d.symbol] = (held[d.symbol] ?? 0) + shares;
      cash -= shares * price;
    } else {
      reject(d, `Unknown action "${d.action}".`);
      continue;
    }

    approved.push({ ...order, shares, ruleNote: notes.join("; ") || null });
  }
  return { approved, rejected };
}
