import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

let server, base;
before(async () => {
  process.env.APP_PASSWORD = "secret pass";
  process.env.DATA_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "trader-")), "p.json");
  delete process.env.ANTHROPIC_API_KEY;
  const { app } = await import("../server.js");
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test("pages and API need the password", async () => {
  const page = await fetch(base + "/", { redirect: "manual" });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get("location"), "/login");
  assert.equal((await fetch(base + "/api/state")).status, 401);
  assert.equal((await fetch(base + "/healthz")).status, 200);
  assert.equal((await fetch(base + "/icon-180.png")).status, 200);
});

test("wrong password is refused, right one logs in", async () => {
  const post = (pw) => fetch(base + "/login", {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: pw }),
  });
  assert.equal((await post("nope")).status, 401);
  const ok = await post("secret pass");
  assert.equal(ok.status, 302);
  const cookie = ok.headers.get("set-cookie").split(";")[0];
  const state = await fetch(base + "/api/state", { headers: { cookie } });
  assert.equal(state.status, 200);
  assert.equal((await state.json()).settings.startingCash, 100000);
});
