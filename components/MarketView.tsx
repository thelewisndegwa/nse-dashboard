"use client";

import { useMemo, useState } from "react";
import { pct, price, tone } from "@/lib/format";
import { matchStock } from "@/lib/stocks";
import type { LiveBoard, StockInfo } from "@/lib/types";

type SortKey = "board" | "name" | "price" | "change" | "volume";

const INDEXES = [
  { code: "^NASI", label: "All-share" },
  { code: "^N20I", label: "NSE 20" },
  { code: "^N25I", label: "NSE 25" },
  { code: "^N10I", label: "NSE 10" },
];

type Props = {
  board: LiveBoard | null;
  error: string | null;
  stocks: StockInfo[];
  onWhatIf: (code: string) => void;
};

export function MarketView({ board, error, stocks, onWhatIf }: Props) {
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("All");
  const [sort, setSort] = useState<SortKey>("board");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const stock of stocks) {
      map.set(stock.liveCode, stock.name);
      map.set(stock.code, stock.name);
    }
    return map;
  }, [stocks]);

  const quotes = board?.quotes ?? [];
  const byCode = useMemo(() => new Map(quotes.map((quote) => [quote.code, quote])), [quotes]);
  const sectors = useMemo(
    () => ["All", ...Array.from(new Set(quotes.filter((quote) => !quote.index).map((quote) => quote.sector)))],
    [quotes]
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = quotes
      .map((quote, index) => ({ quote, index, name: names.get(quote.code) || quote.name }))
      .filter(({ quote, name }) => {
        if (sector !== "All" && quote.sector !== sector) return false;
        if (!q && quote.index) return false;
        if (!q) return true;
        return quote.code.toLowerCase().includes(q) || name.toLowerCase().includes(q);
      });
    const sign = dir === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      if (sort === "board") return a.index - b.index;
      if (sort === "name") return a.name.localeCompare(b.name) * sign;
      if (sort === "price") return (a.quote.price - b.quote.price) * sign;
      if (sort === "volume") return ((a.quote.volume ?? -1) - (b.quote.volume ?? -1)) * sign;
      return ((a.quote.changePct ?? 0) - (b.quote.changePct ?? 0)) * sign;
    });
    return filtered;
  }, [quotes, query, sector, sort, dir, names]);

  const movers = useMemo(() => {
    const tradable = quotes.filter((quote) => !quote.index && quote.changePct != null && quote.changePct !== 0);
    const gainers = [...tradable].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0)).slice(0, 5);
    const losers = [...tradable].sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0)).slice(0, 5);
    return { gainers, losers };
  }, [quotes]);

  function header(key: SortKey, label: string, className?: string) {
    return (
      <th className={className}>
        <button
          type="button"
          onClick={() => {
            if (sort === key) setDir((current) => (current === "asc" ? "desc" : "asc"));
            else {
              setSort(key);
              setDir(key === "name" ? "asc" : "desc");
            }
          }}
        >
          {label}
          {sort === key ? (dir === "asc" ? " ↑" : " ↓") : ""}
        </button>
      </th>
    );
  }

  const counts = quotes.filter((quote) => !quote.index);
  const up = counts.filter((quote) => (quote.changePct ?? 0) > 0).length;
  const down = counts.filter((quote) => (quote.changePct ?? 0) < 0).length;

  return (
    <>
      {error && <div className="banner error">{error}</div>}
      <div className="strip">
        {INDEXES.map((item) => {
          const quote = byCode.get(item.code);
          return (
            <article className="card index-card" key={item.code}>
              <span>{item.label}</span>
              <strong>{quote ? price(quote.price) : "—"}</strong>
              <em className={`pill ${tone(quote?.changePct)}`}>{quote?.changePct == null ? "—" : pct(quote.changePct)}</em>
            </article>
          );
        })}
      </div>
      <div className="movers">
        <section className="card panel">
          <h2>Gainers</h2>
          {movers.gainers.map((quote) => (
            <button className="mover" type="button" key={quote.code} onClick={() => matchStock(stocks, quote.code) && onWhatIf(quote.code)}>
              <span>
                <b>{quote.code}</b>
                <small>{names.get(quote.code) || quote.name}</small>
              </span>
              <span className={tone(quote.changePct)}>{pct(quote.changePct ?? 0)}</span>
            </button>
          ))}
          {movers.gainers.length === 0 && <p className="note">Waiting for the board.</p>}
        </section>
        <section className="card panel">
          <h2>Losers</h2>
          {movers.losers.map((quote) => (
            <button className="mover" type="button" key={quote.code} onClick={() => matchStock(stocks, quote.code) && onWhatIf(quote.code)}>
              <span>
                <b>{quote.code}</b>
                <small>{names.get(quote.code) || quote.name}</small>
              </span>
              <span className={tone(quote.changePct)}>{pct(quote.changePct ?? 0)}</span>
            </button>
          ))}
          {movers.losers.length === 0 && <p className="note">Waiting for the board.</p>}
        </section>
      </div>
      <section className="card panel">
        <div className="panel-head">
          <h2>Board</h2>
          <span className="muted">
            {up} up · {down} down · {counts.length - up - down} unchanged
          </span>
        </div>
        <div className="filters">
          <div className="chips">
            {sectors.map((item) => (
              <button key={item} type="button" className="chip" aria-pressed={sector === item} onClick={() => setSector(item)}>
                {item}
              </button>
            ))}
          </div>
          <input className="search" value={query} placeholder="Search Safaricom, SCOM…" onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {header("name", "Name", "left")}
                {header("price", "Price")}
                {header("change", "Change")}
                {header("volume", "Volume", "hide-sm")}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ quote, name }) => {
                const known = matchStock(stocks, quote.code);
                return (
                  <tr
                    key={quote.code}
                    className={known ? "clickable" : undefined}
                    onClick={() => known && onWhatIf(quote.code)}
                  >
                    <td className="left name-cell">
                      <b>{name}</b>
                      <small>
                        {quote.code}
                        {quote.sector ? ` · ${quote.sector}` : ""}
                      </small>
                    </td>
                    <td>{price(quote.price)}</td>
                    <td className={tone(quote.changePct)}>{quote.changePct == null ? "—" : pct(quote.changePct)}</td>
                    <td className="hide-sm">{quote.volumeLabel}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
