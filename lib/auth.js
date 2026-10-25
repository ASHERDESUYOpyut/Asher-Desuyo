// Password login with a long-lived cookie. Works in iPhone home-screen apps,
// where the browser's built-in password popup is unreliable.
import crypto from "node:crypto";

const COOKIE = "ai_trader_session";
const PUBLIC_PATHS = new Set(["/login", "/healthz", "/manifest.json", "/icon-180.png", "/icon-512.png", "/style.css"]);

function sessionToken(password) {
  // Changing APP_PASSWORD signs everyone out.
  return crypto.createHmac("sha256", password).update("ai-trader-session-v1").digest("hex");
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function authMiddleware(password) {
  const token = sessionToken(password);
  return (req, res, next) => {
    if (PUBLIC_PATHS.has(req.path)) return next();
    if (safeEqual(readCookie(req, COOKIE) ?? "", token)) return next();
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Please log in again." });
    res.redirect("/login");
  };
}

export function loginRoutes(app, password) {
  const token = sessionToken(password);
  app.get("/login", (req, res) => res.send(loginPage()));
  app.post("/login", async (req, res) => {
    if (safeEqual(req.body?.password ?? "", password)) {
      const secure = req.secure ? "; Secure" : "";
      res.set("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`);
      return res.redirect("/");
    }
    await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
    res.status(401).send(loginPage("Wrong password."));
  });
}

function loginPage(error = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Trader · Log in</title><link rel="stylesheet" href="/style.css">
<link rel="manifest" href="/manifest.json"><link rel="apple-touch-icon" href="/icon-180.png">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="AI Trader">
</head><body><main style="max-width:380px;padding-top:15vh">
<form method="post" action="/login" class="panel">
<h1>AI Trader</h1>
<label>Password<input type="password" name="password" autocomplete="current-password" required autofocus></label>
${error ? `<p class="err small">${error}</p>` : ""}
<button class="primary" type="submit">Log in</button>
</form></main></body></html>`;
}
