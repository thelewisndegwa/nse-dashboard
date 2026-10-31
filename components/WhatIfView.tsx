"use client";

import { useEffect, useMemo, useState } from "react";
import { comma, niceDate, pct, tone } from "@/lib/format";
import { matchStock } from "@/lib/stocks";
import type { StockInfo, WhatIfResult } from "@/lib/types";
import { PriceChart } from "./PriceChart";
import { StockPicker, type PickerItem } from "./StockPicker";

const AMOUNTS = [
  { label: "10k", value: "10000" },
  { label: "50k", value: "50000" },
  { label: "100k", value: "100000" },
  { label: "500k", value: "500000" },
  { label: "1m", value: "1000000" },
];

type Props = {
  stocks: StockInfo[];
  historyEnd: string;
  quoteVersion: number;
};

function parseAmount(value: string): number {
  return Number(value.replace(/,/g, "").trim());
}

function monthsAgoIso(months: number, now = new Date()): string {
  const then = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
  const y = then.getFullYear();
  const m = String(then.getMonth() + 1).padStart(2, "0");
  const d = String(then.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function yearsAgoIso(years: number, now = new Date()): string {
  return monthsAgoIso(years * 12, now);
}

function defaultBuyDate(historyEnd: string): string {
  const ago = yearsAgoIso(1);
  return historyEnd && ago > historyEnd ? historyEnd : ago;
}

export function WhatIfView({ stocks, historyEnd, quoteVersion }: Props) {
  const [code, setCode] = useState("");
  const [date, setDate] = useState(() => defaultBuyDate(historyEnd));
  const [amount, setAmount] = useState("100,000");
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const items = useMemo<PickerItem[]>(
    () =>
      stocks.map((stock) => ({
        code: stock.code,
        name: stock.name,
        extra: stock.formerCodes.join(" "),
        hint: stock.formerCodes.length ? `was ${stock.formerCodes.join(", ")}` : undefined,
      })),
    [stocks]
  );

  const stock = matchStock(stocks, code);
  const invested = parseAmount(amount);

  useEffect(() => {
    if (code || !stocks.length) return;
    setCode(stocks.find((item) => item.code === "SCOM")?.code || stocks[0].code);
  }, [stocks, code]);

  useEffect(() => {
    if (!stock) return;
    if (date < stock.first) setDate(stock.first);
    else if (stock.last && date > stock.last) setDate(stock.last);
  }, [stock, date]);

  useEffect(() => {
    if (!code || !date || !(invested > 0)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams({ code, date, amount: String(invested) });
      setLoading(true);
      try {
        const response = await fetch(`/api/whatif?${params.toString()}`, { signal: controller.signal });
        const data = (await response.json()) as WhatIfResult & { error?: string };
        if (!response.ok) throw new Error(data.error || "Could not price that trade");
        setResult(data);
        setError(null);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Could not price that trade");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [code, date, invested, quoteVersion]);

  const datePresets = stock
    ? [
        { label: "6 months ago", months: 6 },
        { label: "1 year ago", months: 12 },
        { label: "3 years ago", months: 36 },
        { label: "5 years ago", months: 60 },
        { label: "10 years ago", months: 120 },
      ]
        .map((preset) => ({ label: preset.label, date: monthsAgoIso(preset.months) }))
        .filter((preset) => preset.date >= stock.first && preset.date <= stock.last)
    : [];

  const chartPoints = result?.points.map((point) => ({ d: point.d, p: point.v })) ?? [];
  const actions = result?.steps.map((step) => `${step.label} on ${niceDate(step.date)}`).join("; ");

  return (
    <div className="whatif">
      <form
        className="ask"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label className="money">
          <span>If I had put</span>
          <div className="money-row">
            <em>KES</em>
            <input
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              placeholder="100,000"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/[^\d.,]/g, ""))}
              onBlur={() => {
                if (invested > 0) setAmount(Math.round(invested).toLocaleString("en-KE"));
              }}
              aria-label="Amount in Kenyan shillings"
            />
          </div>
        </label>
        <div className="sums">
          {AMOUNTS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              aria-pressed={String(invested) === preset.value}
              onClick={() => setAmount(Number(preset.value).toLocaleString("en-KE"))}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="ask-grid">
          <StockPicker label="into" items={items} value={code} onChange={setCode} />
          <div>
            <label className="field">
              <span>on</span>
              <input type="date" value={date} min={stock?.first} max={stock?.last || historyEnd} onChange={(event) => setDate(event.target.value)} />
            </label>
            <div className="sums">
              {datePresets.map((preset) => (
                <button key={preset.label} type="button" aria-pressed={date === preset.date} onClick={() => setDate(preset.date)}>
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {stock?.formerCodes.length ? <p className="quiet">Earlier ticker: {stock.formerCodes.join(", ")}</p> : null}
      </form>

      <section className="answer">
        {error && <div className="banner error">{error}</div>}
        {!result && !error && <p className="loading">{loading ? "Working it out…" : "Pick a stock and a date."}</p>}
        {result && (
          <>
            <p className="now">
              <em>KES</em> <span>{comma(result.value)}</span>
            </p>
            <p className="from">
              from {comma(result.cost)} in {result.name}, {niceDate(result.tradeDate)}
              {result.tradeDate !== result.requestedDate ? ` — next session after ${niceDate(result.requestedDate)}` : ""}
            </p>
            <p className="facts">
              <span className={tone(result.profit)}>
                {result.profit >= 0 ? "+" : ""}
                {comma(result.profit)}
                <i>profit</i>
              </span>
              <span className={tone(result.returnPct)}>
                {pct(result.returnPct)}
                <i>return</i>
              </span>
            </p>
            <PriceChart points={chartPoints} liveAttached={result.liveAttached} />
            {actions ? <p className="quiet">Adjusted for {actions}.</p> : null}
            {result.warnings.map((warning) => (
              <p className="banner" key={warning}>
                {warning}
              </p>
            ))}
            {result.tickerThen !== result.liveCode ? (
              <p className="quiet">It traded as {result.tickerThen}; live ticker is {result.liveCode}.</p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
