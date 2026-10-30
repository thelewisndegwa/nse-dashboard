import fs from "fs";
import path from "path";
import { DATA_DIR, isoToYmd, parseCsvLine, type Series } from "./history";

export type Dividend = {
  code: string;
  date: number;
  dps: number;
  type: string;
};

export const DIVIDENDS_FILE = "dividends.csv";

type Cached = { signature: string; byCode: Map<string, Dividend[]> };
const cache = globalThis as unknown as { __nseDividendsV1?: Cached };

export function parseDividends(text: string): Dividend[] {
  const rows: Dividend[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim() || line.trimStart().startsWith("#")) continue;
    const cols = parseCsvLine(line);
    const code = (cols[0] ?? "").trim().toUpperCase();
    const date = isoToYmd((cols[1] ?? "").trim());
    const dps = Number.parseFloat((cols[2] ?? "").trim());
    const type = (cols[3] ?? "").trim();
    if (!code || date == null || !Number.isFinite(dps) || dps <= 0) continue;
    rows.push({ code, date, dps, type });
  }
  rows.sort((a, b) => a.code.localeCompare(b.code) || a.date - b.date);
  return rows;
}

export function dividendsByCode(rows: Dividend[]): Map<string, Dividend[]> {
  const byCode = new Map<string, Dividend[]>();
  for (const row of rows) {
    const list = byCode.get(row.code);
    if (list) list.push(row);
    else byCode.set(row.code, [row]);
  }
  return byCode;
}

/** Re-reads nse-data/dividends.csv when the file changes. Missing file is an empty ledger. */
export function getDividends(dir = DATA_DIR): Map<string, Dividend[]> {
  const file = path.join(dir, DIVIDENDS_FILE);
  let signature = "missing";
  if (fs.existsSync(file)) {
    const stat = fs.statSync(file);
    signature = `${stat.size}:${stat.mtimeMs}`;
  }
  if (cache.__nseDividendsV1?.signature === signature) return cache.__nseDividendsV1.byCode;
  const byCode = signature === "missing" ? new Map<string, Dividend[]>() : dividendsByCode(parseDividends(fs.readFileSync(file, "utf8")));
  cache.__nseDividendsV1 = { signature, byCode };
  return byCode;
}

export function dividendsFor(series: Series, byCode: Map<string, Dividend[]> | undefined): Dividend[] {
  if (!byCode?.size) return [];
  return byCode.get(series.code) ?? byCode.get(series.liveCode) ?? series.formerCodes.reduce<Dividend[] | undefined>((found, code) => found ?? byCode.get(code), undefined) ?? [];
}

export function formatDps(dps: number): string {
  const text = dps.toFixed(4).replace(/\.?0+$/, "");
  return text || "0";
}
