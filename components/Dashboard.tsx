"use client";

import { useCallback, useEffect, useState } from "react";
import type { LiveBoard, StockInfo } from "@/lib/types";
import { WhatIfView } from "./WhatIfView";

type Catalog = { historyStart: string; historyEnd: string; stocks: StockInfo[] };

export function Dashboard() {
  const [board, setBoard] = useState<LiveBoard | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [quoteVersion, setQuoteVersion] = useState(0);

  const loadBoard = useCallback(async (fresh: boolean) => {
    const response = await fetch(fresh ? "/api/live?fresh=1" : "/api/live");
    const data = (await response.json()) as LiveBoard & { error?: string };
    if (!response.ok) throw new Error(data.error || "Could not load live prices");
    setBoard(data);
    setQuoteVersion(Date.now());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/stocks")
      .then(async (response) => {
        const data = (await response.json()) as Catalog & { error?: string };
        if (!response.ok) throw new Error(data.error || "Could not load prices");
        if (!cancelled) setCatalog(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) setCatalogError(error instanceof Error ? error.message : "Could not load prices");
      });
    loadBoard(false).catch(() => {
      /* live quote is optional; what-if still uses the last close */
    });
    return () => {
      cancelled = true;
    };
  }, [loadBoard]);

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div>
            <h1>NSE What if</h1>
            <p>Nairobi Securities Exchange</p>
          </div>
        </div>
      </header>

      {board?.stale && <div className="banner">Showing the last live board we could reach. Today’s value uses the last close.</div>}
      {catalogError && <div className="banner error">{catalogError}</div>}
      {!catalog && !catalogError && <p className="loading">Loading…</p>}

      {catalog && (
        <WhatIfView stocks={catalog.stocks} historyEnd={catalog.historyEnd} quoteVersion={quoteVersion} />
      )}

      <footer className="footer">Dividends are not included. Not investment advice.</footer>
    </main>
  );
}
