export type Quote = {
  code: string;
  name: string;
  sector: string;
  price: number;
  changePct: number | null;
  previous: number | null;
  volumeLabel: string;
  volume: number | null;
  index: boolean;
  inactive: boolean;
};

export type LiveBoard = {
  asOf: string;
  asOfISO: string | null;
  fetchedAt: string;
  quotes: Quote[];
  stale: boolean;
  source: string;
  marketOpen: boolean;
};

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

export type SeriesPoint = { d: string; p: number };

export type WhatIfStep = {
  date: string;
  label: string;
  ratio: number;
  sharesBefore: number;
  sharesAfter: number;
  dividend?: number;
};

export type WhatIfResult = {
  code: string;
  name: string;
  liveCode: string;
  tickerThen: string;
  requestedDate: string;
  tradeDate: string;
  tradedPrice: number;
  mode: "amount" | "shares";
  sharesBought: number;
  sharesNow: number;
  cash: number;
  dividends: number;
  dividendCount: number;
  dividendFrom: string | null;
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
  benchmark: {
    code: string;
    name: string;
    thenLevel: number;
    nowLevel: number;
    value: number;
    returnPct: number;
  } | null;
  warnings: string[];
  historyEnd: string;
};

export type Holding = {
  id: string;
  code: string;
  liveCode: string;
  name: string;
  shares: number;
  avgCost: number;
  buyDate?: string;
};
