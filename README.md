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

## Run it

Needs Node.js 20 or newer.

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # optional; get one at console.anthropic.com
npm start                             # then open http://localhost:3000
```

Optional settings:

| Variable | What it does |
|---|---|
| `APP_PASSWORD` | Asks for a password before showing the site. **Set this if you put the site online**, so strangers can't run it and spend your API credit. |
| `CLAUDE_MODEL` | Which Claude model to use (default `claude-opus-5-5`). |
| `PORT` | Port to serve on (default 3000). |
| `DATA_FILE` | Where the portfolio is saved (default `data/portfolio.json`). |

## Cost

Each run with Claude is one API call, plus a few web searches when news search is on. With 6 stocks, expect very roughly a few cents to about $0.25 per run. Auto-running every 30 minutes during market hours is about 13 runs a day.

## Prices

"Real prices" uses Yahoo Finance's public chart data (no key). It's unofficial and can be rate-limited or change. "Demo prices" makes up prices so you can test any time.

## Tests

```bash
npm test
```
