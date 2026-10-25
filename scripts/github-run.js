// Used by GitHub Actions: run one analysis (if the market is open), save the
// portfolio, and build the view-only website.
//   node scripts/github-run.js [--force] [--reset] [--site <dir>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../lib/portfolio.js";
import { runAnalysis, publicView, applySettings } from "../lib/engine.js";
import { marketOpenNow } from "../lib/market.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const siteDir = args.includes("--site") ? path.resolve(args[args.indexOf("--site") + 1]) : null;

const store = new Store(process.env.DATA_FILE || path.join(root, "data", "portfolio.json"));

// settings.json in the repo is how you change settings in this mode.
const settingsFile = path.join(root, "settings.json");
if (fs.existsSync(settingsFile)) {
  try {
    applySettings(store.state.settings, JSON.parse(fs.readFileSync(settingsFile, "utf8")));
  } catch (err) {
    console.error(`settings.json has a mistake and was ignored: ${err.message}`);
  }
}
if (flag("--reset")) {
  store.reset();
  console.log("Portfolio reset.");
}

const open = await marketOpenNow();
if (flag("--no-run")) {
  console.log("Website rebuild only, no analysis.");
} else if (flag("--force") || open || store.state.settings.dataProvider === "demo") {
  const run = await runAnalysis(store.state, process.env.GITHUB_EVENT_NAME === "schedule" ? "auto" : "manual");
  console.log(`${run.engine} · prices from ${run.priceSource ?? "nowhere"} · ${run.executed.length} trade(s)`);
  for (const t of run.executed) console.log(`  ${t.side.toUpperCase()} ${t.shares} ${t.symbol} @ ${t.price}: ${t.reason}`);
  for (const e of run.errors) console.log(`  problem: ${e}`);
} else {
  console.log("US market is closed, so no analysis this time.");
}
store.save();

if (siteDir) {
  fs.mkdirSync(siteDir, { recursive: true });
  fs.cpSync(path.join(root, "public"), siteDir, { recursive: true });
  const view = publicView(store.state, {
    running: false,
    mode: "github",
    marketOpen: open,
    repo: process.env.GITHUB_REPOSITORY || null,
    branch: process.env.GITHUB_REF_NAME || null,
    updatedAt: new Date().toISOString(),
  });
  fs.writeFileSync(path.join(siteDir, "state.json"), JSON.stringify(view));
  console.log(`Website built in ${siteDir}`);
}
