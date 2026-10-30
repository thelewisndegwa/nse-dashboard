import type { StockInfo } from "./types";

/** Highest-turnover NSE names, pinned at the top of pickers. */
export const POPULAR_CODES = ["SCOM", "EQTY", "KCB", "EABL", "COOP"] as const;

export function sortListedStocks<T extends { code: string; name: string }>(stocks: T[]): T[] {
  const rank = new Map<string, number>(POPULAR_CODES.map((code, i) => [code, i]));
  return [...stocks].sort((a, b) => {
    const aRank = rank.get(a.code);
    const bRank = rank.get(b.code);
    if (aRank != null && bRank != null) return aRank - bRank;
    if (aRank != null) return -1;
    if (bRank != null) return 1;
    return a.name.localeCompare(b.name);
  });
}

export function matchStock(stocks: StockInfo[], code: string): StockInfo | undefined {
  const needle = code.trim().toUpperCase();
  return stocks.find(
    (stock) =>
      stock.code.toUpperCase() === needle ||
      stock.liveCode.toUpperCase() === needle ||
      stock.formerCodes.some((former) => former.toUpperCase() === needle)
  );
}
