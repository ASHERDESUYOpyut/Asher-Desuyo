# AI Trader

A practice-money stock trading website. Claude looks at your watchlist and decides what to buy, sell or hold. Fixed safety rules check every trade before it happens. Each trade shows Claude's reasoning and has a **Copy** button with the order text, in case you want to place it yourself in Robinhood.

**No real money is used, and the site never places real orders.** This is not financial advice. AI picks can and do lose money.

## How it works

1. You press **Run analysis**, or turn on auto-run.
2. The site gets 6 months of daily prices for each watchlist stock and works out trend and momentum numbers.
3. **Stop-loss rule** sells any holding that dropped too far below what was paid (default 8%).
4. **Claude** gets the portfolio and the data, can search the web for recent news, and returns a buy/sell/hold decision with a reason for each stock.
5. **Safety rules** trim or block anything that breaks your limits:
   - max % of the portfolio in one stock (default 10%)
   - min % kept in cash (default 10%)
   - max trades per run (default 5)
   - watchlist stocks only, no short selling
6. Allowed trades fill in the practice portfolio at the current price.

Without an API key, a simple moving-average strategy is used instead of Claude, so you can try the site for free.

## Put it online for free (GitHub)

GitHub runs the analysis every 30 minutes while the US market is open and publishes a view-only page at
**https://asherdesuyopyut.github.io/Asher-Desuyo/**. One-time setup, all in the repo's **Settings**:

1. **Pages** → *Build and deployment* → Source: **GitHub Actions**.
2. **Secrets and variables → Actions → New repository secret**, add:
   - `ANTHROPIC_API_KEY`: from console.anthropic.com (leave out to use the backup strategy)
   - `ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY`: from a free alpaca.markets account (Home → API Keys; no deposit needed). Optional; without them prices come from Yahoo.
3. **Actions** tab → **AI Trader** → **Run workflow** to do the first run.

Then:
- **Change settings** by editing `settings.json` (watchlist, safety limits; `"dataProvider"` is `"real"` or `"demo"`).
- **Run now or reset** from Actions → AI Trader → Run workflow.
- The portfolio is saved on the `portfolio-data` branch.
- The page is public (anyone with the link can see the practice trades). Your keys stay secret.

## Put it online on a paid server (Render, optional)

Gives you the full site with login, Run button and settings on the page, for about $7/month.
Open https://render.com/deploy?repo=https://github.com/ASHERDESUYOpyut/Asher-Desuyo, fill in `APP_PASSWORD` and `ANTHROPIC_API_KEY` (plus the Alpaca keys if you have them), and tap Deploy.

## Run it on your own computer

Needs Node.js 20 or newer.

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # optional; get one at console.anthropic.com
npm start                             # then open http://localhost:3000
```

Optional settings:

| Variable | What it does |
|---|---|
| `APP_PASSWORD` | Shows a login page and asks for this password. **Set this if you put the site online**, so strangers can't run it and spend your API credit. |
| `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY` | Free Alpaca keys for reliable real-time prices. Without them, Yahoo Finance is used. |
| `CLAUDE_MODEL` | Which Claude model to use (default `claude-opus-5-5`). |
| `PORT` | Port to serve on (default 3000). |
| `DATA_FILE` | Where the portfolio is saved (default `data/portfolio.json`). |

## Cost

Each run with Claude is one API call, plus a few web searches when news search is on. With 6 stocks, expect very roughly a few cents to about $0.25 per run. Auto-running every 30 minutes during market hours is about 13 runs a day.

## Prices

"Real prices" come from Alpaca's free official data (IEX feed, real-time) when Alpaca keys are set, otherwise from Yahoo Finance's unofficial public data, which often blocks cloud servers. Robinhood has no official price API; its prices are the same market prices anyway. "Demo prices" makes up prices so you can test any time.

## Tests

```bash
npm test
```
