// Market data: daily price history plus a few standard indicators.
// "yahoo" pulls real prices (no key needed). "demo" makes up realistic-looking
// prices so the site can be tried anywhere, even offline.

const YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";

export async function getMarketData(symbols, provider = "yahoo") {
  const results = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const bars = provider === "demo" ? demoBars(symbol) : await yahooBars(symbol);
        if (bars.length < 2) throw new Error("not enough price history");
        return { symbol, ...summarize(bars) };
      } catch (err) {
        return { symbol, error: err.message };
      }
    }),
  );
  return results;
}

async function yahooBars(symbol) {
  const url = `${YAHOO_URL}${encodeURIComponent(symbol)}?range=6mo&interval=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (ai-trader)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`price lookup failed (HTTP ${res.status})`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(json?.chart?.error?.description || "unknown symbol");
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const volumes = result.indicators?.quote?.[0]?.volume ?? [];
  const bars = [];
  result.timestamp.forEach((t, i) => {
    if (closes[i] != null) bars.push({ date: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i], volume: volumes[i] ?? 0 });
  });
  // Use the live price for today when Yahoo provides it.
  const live = result.meta?.regularMarketPrice;
  if (live && bars.length) bars[bars.length - 1].close = live;
  return bars;
}

// Seeded random walk so each symbol is stable within a day but moves day to day,
// with a small intraday wiggle so repeated runs see slightly different prices.
function demoBars(symbol, days = 130) {
  let seed = [...symbol].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  let price = 50 + rand() * 400;
  const drift = (rand() - 0.45) * 0.004;
  const bars = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    price *= 1 + drift + (rand() - 0.5) * 0.04;
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    bars.push({ date: d.toISOString().slice(0, 10), close: price, volume: Math.round(1e6 + rand() * 5e6) });
  }
  const minute = Math.floor(Date.now() / 60000);
  bars[bars.length - 1].close *= 1 + Math.sin(minute + seed) * 0.01;
  return bars;
}

export function summarize(bars) {
  const closes = bars.map((b) => b.close);
  const last = closes.at(-1);
  const pct = (n) => (closes.length > n ? round(((last - closes.at(-1 - n)) / closes.at(-1 - n)) * 100) : null);
  return {
    price: round(last),
    change1dPct: pct(1),
    change5dPct: pct(5),
    change20dPct: pct(20),
    sma20: round(sma(closes, 20)),
    sma50: round(sma(closes, 50)),
    rsi14: round(rsi(closes, 14)),
    high6mo: round(Math.max(...closes)),
    low6mo: round(Math.min(...closes)),
    last20Closes: closes.slice(-20).map(round),
  };
}

export function sma(values, n) {
  if (values.length < n) return null;
  return values.slice(-n).reduce((a, b) => a + b, 0) / n;
}

export function rsi(values, n = 14) {
  if (values.length <= n) return null;
  let gains = 0, losses = 0;
  for (let i = values.length - n; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

function round(x) {
  return x == null ? null : Math.round(x * 100) / 100;
}

// US stock market regular hours, Mon-Fri 9:30-16:00 New York time (holidays not included).
export function isMarketOpen(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" })
      .formatToParts(now).map((p) => [p.type, p.value]),
  );
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 570 && minutes < 960;
}
