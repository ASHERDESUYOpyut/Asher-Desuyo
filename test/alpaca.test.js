// Alpaca prices against a fake Alpaca server.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

let fake, seen = [];
before(async () => {
  fake = http.createServer((req, res) => {
    seen.push({ url: req.url, key: req.headers["apca-api-key-id"] });
    const u = new URL(req.url, "http://x");
    res.setHeader("content-type", "application/json");
    if (u.pathname.endsWith("/bars")) {
      // Two pages, to check paging works.
      const bars = (from, n) => Array.from({ length: n }, (_, i) => ({ t: `2026-${String(from + Math.floor(i / 28)).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}T04:00:00Z`, c: 100 + i, v: 1000 }));
      if (!u.searchParams.get("page_token")) return res.end(JSON.stringify({ bars: { AAPL: bars(4, 56) }, next_page_token: "p2" }));
      return res.end(JSON.stringify({ bars: { AAPL: bars(6, 56) }, next_page_token: null }));
    }
    if (u.pathname.endsWith("/trades/latest")) return res.end(JSON.stringify({ trades: { AAPL: { t: "2026-07-28T15:00:00Z", p: 200.5 } } }));
    res.statusCode = 404; res.end("{}");
  });
  await new Promise((r) => fake.listen(0, r));
  process.env.ALPACA_DATA_URL = `http://127.0.0.1:${fake.address().port}/v2/stocks`;
  process.env.ALPACA_API_KEY_ID = "id";
  process.env.ALPACA_API_SECRET_KEY = "secret";
});
after(() => fake.close());

test("prices come from Alpaca when keys are set", async () => {
  const { getMarketData } = await import("../lib/market.js");
  const [aapl] = await getMarketData(["AAPL"], "yahoo");
  assert.equal(aapl.source, "Alpaca");
  assert.equal(aapl.price, 200.5, "today's bar uses the latest trade");
  assert.ok(aapl.sma50 > 0);
  assert.equal(seen.filter((s) => s.url.includes("/bars")).length, 2, "followed the second page");
  assert.ok(seen.every((s) => s.key === "id"));
  assert.match(seen[0].url, /feed=iex/);
});
