"use client";

import { useEffect, useMemo, useState } from "react";
import { kesExact, niceDate, pct, price, shares, tone } from "@/lib/format";
import { matchStock } from "@/lib/stocks";
import type { Holding, LiveBoard, StockInfo } from "@/lib/types";
import { StockPicker, type PickerItem } from "./StockPicker";

const KEY = "nse-desk-holdings-v1";

type Props = {
  stocks: StockInfo[];
  board: LiveBoard | null;
  onWhatIf: (code: string, date?: string) => void;
};

function isHolding(value: unknown): value is Holding {
  if (!value || typeof value !== "object") return false;
  const row = value as Holding;
  return typeof row.id === "string" && typeof row.code === "string" && typeof row.shares === "number" && typeof row.avgCost === "number";
}

function loadHoldings(): Holding[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isHolding);
  } catch {
    return [];
  }
}

export function PortfolioView({ stocks, board, onWhatIf }: Props) {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [shareText, setShareText] = useState("");
  const [costText, setCostText] = useState("");
  const [buyDate, setBuyDate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [filling, setFilling] = useState(false);

  useEffect(() => {
    setHoldings(loadHoldings());
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem(KEY, JSON.stringify(holdings));
  }, [holdings, ready]);

  const quotes = useMemo(() => new Map((board?.quotes || []).map((quote) => [quote.code, quote])), [board]);

  const items = useMemo<PickerItem[]>(() => {
    const known = new Set(stocks.flatMap((stock) => [stock.code, stock.liveCode, ...stock.formerCodes]));
    const historical = stocks
      .filter((stock) => !stock.index)
      .map((stock) => ({
        code: stock.code,
        name: stock.name,
        extra: stock.formerCodes.join(" "),
        hint: stock.formerCodes.length ? `was ${stock.formerCodes.join(", ")}` : undefined,
      }));
    const liveOnly = (board?.quotes || [])
      .filter((quote) => !quote.index && !known.has(quote.code))
      .map((quote) => ({ code: quote.code, name: quote.name }));
    return [...historical, ...liveOnly];
  }, [stocks, board]);

  useEffect(() => {
    if (!code && items.length) {
      const saf = items.find((item) => item.code === "SCOM");
      setCode(saf?.code || items[0].code);
    }
  }, [items, code]);

  const rows = holdings.map((holding) => {
    const stock = matchStock(stocks, holding.code);
    const quote = quotes.get(holding.liveCode);
    const mark = quote?.price ?? stock?.lastPrice ?? null;
    const source = quote ? "live" : stock ? "last" : "none";
    const value = mark == null ? null : mark * holding.shares;
    const cost = holding.avgCost * holding.shares;
    const profit = value == null ? null : value - cost;
    const returnPct = profit == null || cost === 0 ? null : (profit / cost) * 100;
    let day: number | null = null;
    if (quote && quote.changePct != null && quote.changePct > -100 && mark != null) {
      const previous = quote.changePct === 0 ? mark : mark / (1 + quote.changePct / 100);
      day = (mark - previous) * holding.shares;
    }
    return { holding, stock, quote, mark, source, value, cost, profit, returnPct, day };
  });

  const invested = rows.reduce((sum, row) => sum + row.cost, 0);
  const marketValue = rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
  const priced = rows.every((row) => row.value != null);
  const totalProfit = priced ? marketValue - invested : null;
  const dayTotal = rows.reduce((sum, row) => sum + (row.day ?? 0), 0);

  function resetForm() {
    setEditing(null);
    setShareText("");
    setCostText("");
    setBuyDate("");
    setFormError(null);
  }

  async function fillFromDate() {
    if (!buyDate || !code) return;
    setFilling(true);
    setFormError(null);
    try {
      const response = await fetch(`/api/price?code=${encodeURIComponent(code)}&date=${buyDate}`);
      const data = (await response.json()) as { error?: string; price?: number; tradeDate?: string; adjusted?: boolean };
      if (!response.ok || data.price == null) throw new Error(data.error || "No price on that date");
      setCostText(String(Number(data.price.toFixed(4))));
      setBuyDate(data.tradeDate || buyDate);
      if (data.adjusted) {
        setFormError("Filled with the split-adjusted price, so enter the shares you hold now, not the old share count.");
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not fill that price");
    } finally {
      setFilling(false);
    }
  }

  function save() {
    const sharesHeld = Number(shareText.replace(/,/g, ""));
    const avgCost = Number(costText.replace(/,/g, ""));
    if (!(sharesHeld > 0) || !(avgCost > 0)) {
      setFormError("Enter the shares you hold and what you paid per share.");
      return;
    }
    const stock = matchStock(stocks, code);
    const quote = quotes.get(stock?.liveCode || code);
    const holding: Holding = {
      id: editing || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`),
      code: stock?.code || code,
      liveCode: stock?.liveCode || code,
      name: stock?.name || quote?.name || code,
      shares: sharesHeld,
      avgCost,
      buyDate: buyDate || undefined,
    };
    setHoldings((current) => {
      if (editing) return current.map((item) => (item.id === editing ? holding : item));
      return [...current, holding];
    });
    resetForm();
  }

  function edit(holding: Holding) {
    setEditing(holding.id);
    setCode(holding.code);
    setShareText(String(holding.shares));
    setCostText(String(holding.avgCost));
    setBuyDate(holding.buyDate || "");
    setFormError(null);
  }

  return (
    <>
      <div className="totals">
        <article className="card total">
          <em>Market value</em>
          <strong>{rows.length && priced ? kesExact(marketValue) : rows.length ? "—" : kesExact(0)}</strong>
          <p className="note">{board ? `Marked to ${board.asOf}` : "Live prices not loaded"}</p>
        </article>
        <article className="card total">
          <em>Invested</em>
          <strong>{kesExact(invested)}</strong>
        </article>
        <article className="card total">
          <em>Total return</em>
          <strong className={tone(totalProfit)}>
            {totalProfit == null ? "—" : `${totalProfit >= 0 ? "+" : ""}${kesExact(totalProfit)}`}
          </strong>
          <p className="note">{totalProfit == null || invested === 0 ? "" : pct((totalProfit / invested) * 100)}</p>
        </article>
        <article className="card total">
          <em>Today</em>
          <strong className={tone(dayTotal)}>{rows.some((row) => row.day != null) ? `${dayTotal >= 0 ? "+" : ""}${kesExact(dayTotal)}` : "—"}</strong>
        </article>
      </div>
      <div className="layout">
        <form
          className="card panel"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <h2>{editing ? "Edit holding" : "Add a holding"}</h2>
          <p className="note">Shares you hold now, and your cost per share in today’s terms.</p>
          <StockPicker label="Stock" items={items} value={code} onChange={setCode} />
          <div className="row2">
            <label className="field">
              <span>Shares</span>
              <input inputMode="decimal" value={shareText} onChange={(event) => setShareText(event.target.value)} placeholder="500" />
            </label>
            <label className="field">
              <span>Cost per share</span>
              <input inputMode="decimal" value={costText} onChange={(event) => setCostText(event.target.value)} placeholder="28.50" />
            </label>
          </div>
          <label className="field">
            <span>Bought on, optional</span>
            <input type="date" value={buyDate} min="2007-01-01" max={stocks[0] ? undefined : undefined} onChange={(event) => setBuyDate(event.target.value)} />
          </label>
          <div className="actions">
            <button className="btn" type="button" disabled={!buyDate || !matchStock(stocks, code) || filling} onClick={fillFromDate}>
              {filling ? "Looking up…" : "Use that day’s price"}
            </button>
            <button className="btn primary" type="submit">{editing ? "Save" : "Add"}</button>
            {editing && (
              <button className="btn ghost" type="button" onClick={resetForm}>
                Cancel
              </button>
            )}
          </div>
          {formError && <p className="note">{formError}</p>}
        </form>
        <section className="card panel">
          <h2>Holdings</h2>
          {rows.length === 0 && <p className="empty">Nothing here yet. Add a stock you own and it will be marked to the live board.</p>}
          {rows.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="left">Holding</th>
                    <th>Value</th>
                    <th>Return</th>
                    <th className="hide-sm">Today</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.holding.id}>
                      <td className="left name-cell">
                        <b>{row.holding.name}</b>
                        <small>
                          {shares(row.holding.shares)} @ {price(row.holding.avgCost)}
                          {row.holding.buyDate ? ` · ${niceDate(row.holding.buyDate)}` : ""}
                          {row.source === "last" ? " · last close" : ""}
                        </small>
                      </td>
                      <td>
                        {row.value == null ? "—" : kesExact(row.value)}
                        <small className="muted" style={{ display: "block" }}>
                          {row.mark == null ? "No price" : price(row.mark)}
                        </small>
                      </td>
                      <td className={tone(row.profit)}>
                        {row.profit == null ? "—" : `${row.profit >= 0 ? "+" : ""}${kesExact(row.profit)}`}
                        <small style={{ display: "block" }}>{row.returnPct == null ? "" : pct(row.returnPct)}</small>
                      </td>
                      <td className={`hide-sm ${tone(row.day)}`}>{row.day == null ? "—" : `${row.day >= 0 ? "+" : ""}${kesExact(row.day)}`}</td>
                      <td>
                        <div className="actions">
                          <button className="icon-btn" type="button" onClick={() => onWhatIf(row.holding.liveCode, row.holding.buyDate)}>
                            What if
                          </button>
                          <button className="icon-btn" type="button" onClick={() => edit(row.holding)}>
                            Edit
                          </button>
                          <button
                            className="icon-btn"
                            type="button"
                            onClick={() => {
                              if (confirm(`Remove ${row.holding.name}?`)) {
                                setHoldings((current) => current.filter((item) => item.id !== row.holding.id));
                                if (editing === row.holding.id) resetForm();
                              }
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
