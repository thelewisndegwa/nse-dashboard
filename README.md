# NSE What if

A local dashboard for the Nairobi Securities Exchange. Pick a stock, a past date, and how many shares you bought. It shows what that position would be worth at today’s live price, after splits, bonus issues, and cash dividends.

Daily prices come from the CSV files in `nse-data/` (2007 through the latest backfill). Today’s quote comes from [myStocks](https://live.mystocks.co.ke/m/pricelist).

```bash
npm install
npm test
npm run data-report
npm run dividends
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

`npm run backfill` fills missing weekdays from myStocks after the last date on file. `npm run dividends` refreshes `nse-data/dividends.csv` from TradingView (ex-date and gross DPS). Restart is not required: the loader re-reads `nse-data/` when those files change.

Dividends sit as cash. They are not reinvested. TradingView’s history is shorter than the price files, so long holds may miss earlier payouts. The index comparison is still price-only. Not investment advice.
