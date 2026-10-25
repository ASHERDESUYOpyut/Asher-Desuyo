// Practice portfolio, saved to a JSON file so it survives restarts.
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_SETTINGS = {
  watchlist: ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "SPY"],
  dataProvider: "yahoo", // "yahoo" (real prices) or "demo" (made-up prices)
  startingCash: 100000,
  maxPositionPct: 10, // no single stock may be more than this % of the portfolio
  minCashPct: 10, // always keep at least this % in cash
  stopLossPct: 8, // sell automatically if a holding falls this % below what we paid
  maxTradesPerRun: 5,
  useNewsSearch: true, // let Claude search the web for recent news
  autoRunMinutes: 0, // 0 = only when you press the button
};

export function newState(settings = DEFAULT_SETTINGS) {
  return {
    settings: { ...settings },
    cash: settings.startingCash,
    positions: {}, // SYMBOL -> { shares, avgCost }
    trades: [],
    runs: [],
    history: [],
    lastPrices: {},
  };
}

export class Store {
  constructor(file) {
    this.file = file;
    this.state = this.#load();
  }

  #load() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return { ...newState(), ...saved, settings: { ...DEFAULT_SETTINGS, ...saved.settings } };
    } catch {
      return newState();
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file);
  }

  reset() {
    this.state = newState(this.state.settings);
    this.save();
  }
}

export function totalValue(state, prices = state.lastPrices) {
  let value = state.cash;
  for (const [symbol, pos] of Object.entries(state.positions)) {
    value += pos.shares * (prices[symbol] ?? pos.avgCost);
  }
  return value;
}

// Apply one approved order at the given price. Assumes the rules already checked it.
export function executeOrder(state, { symbol, side, shares, price, reason, source, confidence }) {
  const cost = shares * price;
  const pos = state.positions[symbol] ?? { shares: 0, avgCost: 0 };
  let realizedPnl = null;
  if (side === "buy") {
    pos.avgCost = (pos.avgCost * pos.shares + cost) / (pos.shares + shares);
    pos.shares += shares;
    state.cash -= cost;
    state.positions[symbol] = pos;
  } else {
    realizedPnl = (price - pos.avgCost) * shares;
    pos.shares -= shares;
    state.cash += cost;
    if (pos.shares === 0) delete state.positions[symbol];
  }
  const trade = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: new Date().toISOString(),
    symbol, side, shares,
    price: Math.round(price * 100) / 100,
    reason, source,
    confidence: confidence ?? null,
    realizedPnl: realizedPnl == null ? null : Math.round(realizedPnl * 100) / 100,
  };
  state.trades.unshift(trade);
  state.trades = state.trades.slice(0, 500);
  return trade;
}
