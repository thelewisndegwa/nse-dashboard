import { isoToYmd, sessionOnOrAfter, ymdToIso, ymdToTime, type Market, type Series } from "./history";
import { sortListedStocks } from "./stocks";

export type LivePrice = { price: number; asOf: string };

export type StockInfo = {
  code: string;
  name: string;
  liveCode: string;
  formerCodes: string[];
  index: boolean;
  first: string;
  last: string;
  lastPrice: number;
};

export type WhatIfStep = {
  date: string;
  label: string;
  ratio: number;
  sharesBefore: number;
  sharesAfter: number;
};

export type WhatIfResult = {
  code: string;
  name: string;
  liveCode: string;
  tickerThen: string;
  requestedDate: string;
  tradeDate: string;
  tradedPrice: number;
  mode: "shares" | "amount";
  sharesBought: number;
  sharesNow: number;
  cash: number;
  cost: number;
  nowPrice: number;
  nowAsOf: string;
  priceSource: "live" | "last-close";
  value: number;
  profit: number;
  returnPct: number;
  cagr: number | null;
  years: number;
  steps: WhatIfStep[];
  points: { d: string; v: number }[];
  liveAttached: boolean;
  warnings: string[];
  historyEnd: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const YEAR_MS = 365.25 * 86_400_000;
const MAX_POINTS = 600;

function nice(ymd: number): string {
  return `${ymd % 100} ${MONTHS[Math.floor((ymd % 10000) / 100) - 1]} ${Math.floor(ymd / 10000)}`;
}

function money(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Stocks still trading at the end of the files; delisted names and indices are left out. */
export function listedStocks(market: Market): StockInfo[] {
  const cutoff = ymdToTime(market.end) - 60 * 86_400_000;
  return sortListedStocks(
    market.list
      .filter((series) => !series.index && ymdToTime(series.dates[series.dates.length - 1]) >= cutoff)
      .map((series) => ({
        code: series.code,
        name: series.name,
        liveCode: series.liveCode,
        formerCodes: series.formerCodes,
        index: false,
        first: ymdToIso(series.dates[0]),
        last: ymdToIso(series.dates[series.dates.length - 1]),
        lastPrice: series.closes[series.closes.length - 1],
      }))
  );
}

function downsample<T>(points: T[]): T[] {
  if (points.length <= MAX_POINTS) return points;
  const step = (points.length - 1) / (MAX_POINTS - 1);
  const out: T[] = [];
  for (let i = 0; i < MAX_POINTS; i++) out.push(points[Math.round(i * step)]);
  return out;
}

function liveFor(series: Series, live: Map<string, LivePrice> | null | undefined): { price: number; ymd: number } | null {
  const quote = live?.get(series.liveCode) ?? live?.get(series.code);
  const ymd = quote ? isoToYmd(quote.asOf) : null;
  if (!quote || !(quote.price > 0) || ymd == null) return null;
  return ymd >= series.dates[series.dates.length - 1] ? { price: quote.price, ymd } : null;
}

function jumpWarning(jump: Series["jumps"][number]): string {
  const change = (jump.to / jump.from - 1) * 100;
  const moved = `${change > 0 ? "rose" : "fell"} from ${money(jump.from)} to ${money(jump.to)} (${change > 0 ? "+" : ""}${change.toFixed(0)}%)`;
  const when = `${nice(jump.prevDate)} and ${nice(jump.date)}`;
  return change < 0
    ? `The price ${moved} between ${when}, with no split or bonus on record. If that was a split or bonus issue, the real value today is higher than shown.`
    : `The price ${moved} between ${when}, with no share consolidation on record. If shares were consolidated, the real value today is lower than shown.`;
}

export function whatIf(input: {
  market: Market;
  code: string;
  date: string;
  shares?: number;
  amount?: number;
  live?: Map<string, LivePrice> | null;
}): WhatIfResult | { error: string } {
  const series = input.market.byCode.get(input.code.trim().toUpperCase());
  if (!series || series.index) return { error: "Pick a stock from the list." };
  const requested = isoToYmd(input.date);
  if (requested == null) return { error: "Pick a date." };
  const first = series.dates[0];
  const last = series.dates[series.dates.length - 1];
  if (requested < first) return { error: `${series.name} prices start on ${nice(first)}. Pick that day or later.` };
  if (requested > last) return { error: `${series.name} prices run to ${nice(last)}. Pick that day or earlier.` };

  const idx = sessionOnOrAfter(series, requested);
  const tradeYmd = series.dates[idx];
  const tradedPrice = series.closes[idx];

  let mode: WhatIfResult["mode"];
  let sharesBought: number;
  let cash = 0;
  let cost: number;
  if (input.shares != null && input.shares > 0) {
    mode = "shares";
    sharesBought = input.shares;
    cost = sharesBought * tradedPrice;
  } else if (input.amount != null && input.amount > 0) {
    mode = "amount";
    sharesBought = Math.floor(input.amount / tradedPrice + 1e-9);
    if (sharesBought < 1) return { error: `KES ${money(input.amount)} does not buy one share at ${money(tradedPrice)}.` };
    cash = round2(input.amount - sharesBought * tradedPrice);
    cost = input.amount;
  } else {
    return { error: "Enter an amount." };
  }

  // Shares already reflect an action on the buy session itself, so only later ex-dates count.
  // The NSE does not issue fractions of a bonus share, so whole holdings stay whole.
  const whole = Number.isInteger(sharesBought);
  const live = liveFor(series, input.live);
  const nowPrice = live ? live.price : series.closes[series.closes.length - 1];
  const nowYmd = live ? live.ymd : last;
  const later = series.actions.filter((action) => action.date > tradeYmd);
  const steps: WhatIfStep[] = [];
  let shares = sharesBought;
  for (const action of later) {
    const before = shares;
    shares = whole ? Math.floor(shares * action.ratio + 1e-9) : shares * action.ratio;
    steps.push({ date: ymdToIso(action.date), label: action.label, ratio: action.ratio, sharesBefore: before, sharesAfter: shares });
  }

  const leftover = cash;
  const value = shares * nowPrice + leftover;
  const profit = value - cost;
  const years = Math.max(0, (ymdToTime(nowYmd) - ymdToTime(tradeYmd)) / YEAR_MS);
  const cagr = years >= 1 && value > 0 ? (Math.pow(value / cost, 1 / years) - 1) * 100 : null;

  const points: WhatIfResult["points"] = [];
  let held = sharesBought;
  let next = 0;
  for (let i = idx; i < series.dates.length; i++) {
    while (next < later.length && later[next].date <= series.dates[i]) {
      held = whole ? Math.floor(held * later[next].ratio + 1e-9) : held * later[next].ratio;
      next++;
    }
    points.push({ d: ymdToIso(series.dates[i]), v: round2(held * series.closes[i] + leftover) });
  }
  let liveAttached = false;
  if (live && nowYmd > last) {
    points.push({ d: ymdToIso(nowYmd), v: round2(value) });
    liveAttached = true;
  } else if (live) {
    points[points.length - 1] = { d: ymdToIso(nowYmd), v: round2(value) };
  }

  const tickerThen =
    series.segments.find((segment) => tradeYmd >= segment.from && tradeYmd <= segment.to)?.code ?? series.code;

  const warnings: string[] = [];
  for (const jump of series.jumps) if (jump.date > tradeYmd) warnings.push(jumpWarning(jump));
  const lastClose = series.closes[series.closes.length - 1];
  if (live && Math.abs(Math.log(live.price / lastClose)) > Math.log(2)) {
    warnings.push(
      `Today's price of ${money(live.price)} is far from the last daily close (${money(lastClose)} on ${nice(last)}). A split or bonus may have happened since then.`
    );
  }
  if (!live && ymdToTime(input.market.end) - ymdToTime(last) > 30 * 86_400_000) {
    warnings.push(`${series.name} stopped trading after ${nice(last)}, so this uses its last close.`);
  }

  return {
    code: series.code,
    name: series.name,
    liveCode: series.liveCode,
    tickerThen,
    requestedDate: ymdToIso(requested),
    tradeDate: ymdToIso(tradeYmd),
    tradedPrice,
    mode,
    sharesBought,
    sharesNow: shares,
    cash: leftover,
    cost,
    nowPrice,
    nowAsOf: ymdToIso(nowYmd),
    priceSource: live ? "live" : "last-close",
    value,
    profit,
    returnPct: (value / cost - 1) * 100,
    cagr,
    years,
    steps,
    points: downsample(points),
    liveAttached,
    warnings,
    historyEnd: ymdToIso(last),
  };
}
