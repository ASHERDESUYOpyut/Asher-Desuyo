import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store, DEFAULT_SETTINGS } from "./lib/portfolio.js";
import { isMarketOpen } from "./lib/market.js";
import { hasClaude, MODEL } from "./lib/brain.js";
import { runAnalysis, publicView, applySettings } from "./lib/engine.js";
import { authMiddleware, loginRoutes } from "./lib/auth.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const store = new Store(process.env.DATA_FILE || path.join(here, "data", "portfolio.json"));
const app = express();
app.set("trust proxy", 1); // hosting providers sit in front of the app
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.get("/healthz", (req, res) => res.send("ok"));

// Password so strangers can't run trades (and spend API credit) when this is online.
if (process.env.APP_PASSWORD) {
  loginRoutes(app, process.env.APP_PASSWORD);
  app.use(authMiddleware(process.env.APP_PASSWORD));
} else if (process.env.RENDER) {
  // Online with no password: refuse to serve rather than expose the API key.
  app.use((req, res) => res.status(503).send("Set APP_PASSWORD in your hosting settings to use AI Trader."));
}
app.use(express.static(path.join(here, "public")));

let running = false;

export async function runOnce(trigger = "manual") {
  if (running) throw new Error("A run is already in progress.");
  running = true;
  try {
    return await runAnalysis(store.state, trigger);
  } finally {
    store.save();
    running = false;
  }
}

const publicState = () => publicView(store.state, { running });

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
  applySettings(store.state.settings, req.body || {});
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
