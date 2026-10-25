// End-to-end run with demo prices and a fake Claude API, so no key or network is needed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

let fake, requests = [], reply;

before(async () => {
  fake = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(reply()));
    });
  });
  await new Promise((r) => fake.listen(0, r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.DATA_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "trader-")), "p.json");
});
after(() => fake.close());

const message = (obj) => ({
  id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify(obj) }], usage: { input_tokens: 10, output_tokens: 10 },
});

test("a run asks Claude, applies the rules and records trades", async () => {
  const { runOnce, store } = await import("../server.js");
  store.state.settings.dataProvider = "demo";
  store.state.settings.watchlist = ["AAPL", "MSFT"];
  reply = () => message({
    market_view: "Calm market.",
    decisions: [
      { symbol: "AAPL", action: "buy", shares: 100000, confidence: 0.9, reason: "Strong trend." },
      { symbol: "MSFT", action: "hold", shares: 0, confidence: 0.5, reason: "Wait." },
    ],
  });
  const run = await runOnce();
  assert.deepEqual(run.errors, []);
  assert.equal(run.marketView, "Calm market.");
  assert.equal(run.executed.length, 1);
  const t = run.executed[0];
  assert.equal(t.symbol, "AAPL");
  assert.ok(t.shares * t.price <= 10000.01, "trimmed to 10% of $100k");
  assert.match(t.reason, /Rules: trimmed/);

  const req = requests.at(-1);
  assert.match(req.url, /^\/v1\/messages/);
  assert.equal(req.body.model, "claude-opus-5-5");
  assert.equal(req.body.fallbacks, "default");
  assert.match(req.headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
  assert.equal(req.body.output_config.format.type, "json_schema");
  assert.deepEqual(req.body.tools, [], "no news search with demo prices");
});

test("a bad Claude reply makes no trades", async () => {
  const { runOnce } = await import("../server.js");
  reply = () => ({ ...message({}), content: [{ type: "text", text: "not json" }] });
  const run = await runOnce();
  assert.equal(run.executed.filter((t) => t.source === "claude").length, 0);
  assert.match(run.errors.join(" "), /expected format/);
});
