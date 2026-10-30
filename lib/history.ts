import fs from "fs";
import path from "path";

/** Tickers renamed at the start of 2013. The old code's history continues under the new one. */
export const RENAMES: Record<string, string> = {
  BBK: "ABSA",
  "C&G": "CGEN",
  FIRE: "SMER",
  ICDC: "CTUM",
  CFC: "SBIC",
  NIC: "NCBA",
  BERG: "CRWN",
  CFCI: "LBTY",
  PAFR: "SLAM",
};

/** Ticker in the daily files -> ticker on the myStocks live board. */
export const LIVE_CODES: Record<string, string> = {
  HFCK: "HFCB",
};

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** NSE caps a day's move at about 10%, so anything past these sizes between sessions is not ordinary trading. */
const SPIKE = Math.log(1.3);
const SPIKE_RETURN = Math.log(1.12);
const UNEXPLAINED = Math.log(1.25);
const FACTOR_STEP = Math.log(1.03);

export type Row = {
  code: string;
  fileCode: string;
  name: string;
  date: number;
  close: number;
  adjust: number | null;
  batch: string;
  official: boolean;
};

export type CorporateAction = {
  date: number;
  ratio: number;
  label: string;
  closeBefore: number;
  closeAfter: number;
};

export type PriceJump = {
  prevDate: number;
  date: number;
  from: number;
  to: number;
};

export type Series = {
  code: string;
  name: string;
  liveCode: string;
  formerCodes: string[];
  index: boolean;
  dates: number[];
  closes: number[];
  segments: { code: string; from: number; to: number }[];
  actions: CorporateAction[];
  /** Adjust-column steps that the traded price did not confirm, so they are not applied. */
  unconfirmed: PriceJump[];
  /** Big moves between sessions with no split or bonus to explain them. */
  jumps: PriceJump[];
  dropped: { weekend: number; duplicate: number; spike: number };
};

export type Market = {
  start: number;
  end: number;
  files: string[];
  list: Series[];
  byCode: Map<string, Series>;
  skipped: { rights: number; unreadable: number; outOfYear: number };
};

export function ymdToIso(n: number): string {
  const y = Math.floor(n / 10000);
  const m = Math.floor((n % 10000) / 100);
  const d = n % 100;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function isoToYmd(iso: string): number | null {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? toYmd(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

function toYmd(y: number, m: number, d: number): number | null {
  const time = Date.UTC(y, m - 1, d);
  const check = new Date(time);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return y * 10000 + m * 100 + d;
}

export function ymdToTime(n: number): number {
  return Date.UTC(Math.floor(n / 10000), Math.floor((n % 10000) / 100) - 1, n % 100);
}

function isWeekend(n: number): boolean {
  const day = new Date(ymdToTime(n)).getUTCDay();
  return day === 0 || day === 6;
}

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cur += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      out.push(cur);
      cur = "";
    } else cur += char;
  }
  out.push(cur);
  return out;
}

/** The files use 1/2/2007 (month first) up to 2012 and 2-Jan-13 from 2013. */
export function parseFileDate(raw: string): number | null {
  const value = raw.trim();
  let match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return toYmd(Number(match[3]), Number(match[1]), Number(match[2]));
  match = value.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/);
  if (match) {
    const month = MONTHS[match[2].toLowerCase()];
    if (!month) return null;
    let year = Number(match[3]);
    if (match[3].length === 2) year = year >= 70 ? 1900 + year : 2000 + year;
    return toYmd(year, month, Number(match[1]));
  }
  match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return toYmd(Number(match[1]), Number(match[2]), Number(match[3]));
  return null;
}

function parsePositive(raw: string | undefined): number | null {
  const value = (raw ?? "").trim();
  if (!value || value === "-") return null;
  const n = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Each download restates the Adjust column only within its own years, so a jump in the
 * adjustment factor where two downloads meet is a restart, not a corporate action.
 */
function batchOf(fileName: string, year: number): string {
  if (/mystocks/i.test(fileName)) return "mystocks";
  if (year <= 2012) return "2007-2012";
  if (year <= 2021) return "2013-2021";
  if (year <= 2025) return "2022-2025";
  return String(year);
}

export function parseFile(text: string, fileName: string) {
  const rows: Row[] = [];
  let rights = 0;
  let unreadable = 0;
  let outOfYear = 0;
  const lines = text.split(/\r?\n/);
  const header = parseCsvLine(lines[0] ?? "").map((cell) => cell.trim().toLowerCase());
  const dateIdx = header.indexOf("date");
  const codeIdx = header.indexOf("code");
  const nameIdx = header.indexOf("name");
  const priceIdx = header.indexOf("day price");
  const adjustIdx = header.findIndex((cell) => cell.startsWith("adjust"));
  if (dateIdx < 0 || codeIdx < 0 || priceIdx < 0) return { rows, rights, unreadable, outOfYear };
  const fileYear = Number(fileName.match(/(\d{4})/)?.[1]) || null;
  const official = !/mystocks/i.test(fileName);

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.replace(/,/g, "").trim()) continue;
    const cols = parseCsvLine(line);
    const fileCode = (cols[codeIdx] ?? "").trim().toUpperCase();
    const name = (cols[nameIdx] ?? "").trim();
    if (!fileCode) {
      unreadable++;
      continue;
    }
    if (fileCode.endsWith("-R") || /\brights\b/i.test(name)) {
      rights++;
      continue;
    }
    const date = parseFileDate(cols[dateIdx] ?? "");
    const close = parsePositive(cols[priceIdx]);
    if (date == null || close == null) {
      unreadable++;
      continue;
    }
    if (fileYear && Math.floor(date / 10000) !== fileYear) {
      outOfYear++;
      continue;
    }
    rows.push({
      code: RENAMES[fileCode] ?? fileCode,
      fileCode,
      name: name || fileCode,
      date,
      close,
      adjust: adjustIdx >= 0 ? parsePositive(cols[adjustIdx]) : null,
      batch: batchOf(fileName, Math.floor(date / 10000)),
      official,
    });
  }
  return { rows, rights, unreadable, outOfYear };
}

function logMove(a: number, b: number): number {
  return Math.abs(Math.log(a / b));
}

function factorOf(row: Row): number {
  return row.adjust ? row.close / row.adjust : 1;
}

/**
 * One row per session: official files beat the myStocks backfill, then the row closest to
 * the session before (price first, then adjustment factor) wins.
 */
function dedupe(sorted: Row[]): { rows: Row[]; removed: number } {
  const rows: Row[] = [];
  let removed = 0;
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].date === sorted[i].date) j++;
    const group = sorted.slice(i, j + 1);
    const pool = group.some((row) => row.official) ? group.filter((row) => row.official) : group;
    const prev = rows[rows.length - 1];
    let pick = pool[0];
    if (prev) {
      const distance = (row: Row) => [logMove(row.close, prev.close), logMove(factorOf(row), factorOf(prev))];
      for (const row of pool) {
        const [priceGap, factorGap] = distance(row);
        const [bestPrice, bestFactor] = distance(pick);
        if (priceGap < bestPrice - 1e-9 || (Math.abs(priceGap - bestPrice) <= 1e-9 && factorGap < bestFactor)) pick = row;
      }
    }
    rows.push(pick);
    removed += group.length - 1;
    i = j + 1;
  }
  return { rows, removed };
}

/** Drops runs of up to three sessions that leap away and then come straight back (bad ticks). */
function removeSpikes(rows: Row[]): { rows: Row[]; removed: number } {
  const out: Row[] = [];
  let removed = 0;
  let i = 0;
  while (i < rows.length) {
    const base = out[out.length - 1];
    if (base && logMove(rows[i].close, base.close) > SPIKE) {
      let end = -1;
      for (let k = i; k < Math.min(rows.length - 1, i + 3); k++) {
        const away = rows.slice(i, k + 1).every((row) => logMove(row.close, base.close) > SPIKE);
        if (away && logMove(rows[k + 1].close, base.close) < SPIKE_RETURN) {
          end = k;
          break;
        }
      }
      if (end >= 0) {
        removed += end - i + 1;
        i = end + 1;
        continue;
      }
    }
    out.push(rows[i]);
    i++;
  }
  return { rows: out, removed };
}

function fraction(ratio: number): { num: number; den: number } | null {
  let best: { num: number; den: number } | null = null;
  let bestErr = Infinity;
  for (let den = 1; den <= 10; den++) {
    const num = Math.round(ratio * den);
    if (num <= 0) continue;
    const err = Math.abs(Math.log(num / den / ratio));
    if (err < bestErr - 1e-9) {
      best = { num, den };
      bestErr = err;
    }
  }
  return best && bestErr <= Math.log(1.02) ? best : null;
}

/** 11/10 is "1-for-10 bonus issue" (one new share per ten held), 10/1 is "10-for-1 split". */
export function describeRatio(ratio: number): { ratio: number; label: string } {
  const f = fraction(ratio);
  if (!f) return { ratio: Number(ratio.toFixed(4)), label: `shares x${ratio.toFixed(3)}` };
  const { num, den } = f;
  const exact = num / den;
  if (den === 1 && num > 1) return { ratio: exact, label: `${num}-for-1 split` };
  if (num > den && exact < 2) return { ratio: exact, label: `${num - den}-for-${den} bonus issue` };
  if (num > den) return { ratio: exact, label: `${num}-for-${den} split` };
  return { ratio: exact, label: `${den}-for-${num} consolidation` };
}

/**
 * The Adjust column is Day Price restated into the share count after the download's later
 * splits and bonuses, so Day Price / Adjust is a step function that drops on each ex-date.
 * A step only counts when the traded price falls by about the same ratio that session.
 */
function findActions(rows: Row[]) {
  const factor = rows.map(factorOf);
  const actions: CorporateAction[] = [];
  const unconfirmed: PriceJump[] = [];
  const ratioAt = new Map<number, number>();

  for (let i = 1; i < rows.length; i++) {
    const step = factor[i - 1] / factor[i];
    if (Math.abs(Math.log(step)) < FACTOR_STEP) continue;
    const sameBatch = rows[i - 1].batch === rows[i].batch;
    const big = Math.abs(Math.log(step)) >= Math.log(1.5);
    const tolerance = sameBatch ? Math.log(1.3) : Math.log(1.1);
    const errAt = (k: number) => logMove(rows[k - 1].close / rows[k].close, step);

    let at = errAt(i) <= tolerance ? i : -1;
    if (at < 0 && big) {
      let bestErr = tolerance;
      for (let k = Math.max(1, i - 2); k <= Math.min(rows.length - 1, i + 2); k++) {
        if (errAt(k) <= bestErr) {
          bestErr = errAt(k);
          at = k;
        }
      }
    }
    const allowed = step > 1 ? sameBatch || big : big;
    if (at > 0 && allowed && !ratioAt.has(at)) {
      const { ratio, label } = describeRatio(step);
      actions.push({ date: rows[at].date, ratio, label, closeBefore: rows[at - 1].close, closeAfter: rows[at].close });
      ratioAt.set(at, ratio);
    } else if (sameBatch) {
      unconfirmed.push({ prevDate: rows[i - 1].date, date: rows[i].date, from: rows[i - 1].close, to: rows[i].close });
    }
  }

  const jumps: PriceJump[] = [];
  for (let k = 1; k < rows.length; k++) {
    const move = (rows[k].close / rows[k - 1].close) * (ratioAt.get(k) ?? 1);
    if (Math.abs(Math.log(move)) > UNEXPLAINED) {
      jumps.push({ prevDate: rows[k - 1].date, date: rows[k].date, from: rows[k - 1].close, to: rows[k].close });
    }
  }
  return { actions, unconfirmed, jumps };
}

export function buildSeries(code: string, input: Row[]): Series | null {
  const sorted = [...input].sort((a, b) => a.date - b.date || Number(b.official) - Number(a.official));
  const weekday = sorted.filter((row) => !isWeekend(row.date));
  const unique = dedupe(weekday);
  const clean = removeSpikes(unique.rows);
  const rows = clean.rows;
  if (!rows.length) return null;

  const { actions, unconfirmed, jumps } = findActions(rows);
  const segments: Series["segments"] = [];
  for (const row of rows) {
    const last = segments[segments.length - 1];
    if (last && last.code === row.fileCode) last.to = row.date;
    else segments.push({ code: row.fileCode, from: row.date, to: row.date });
  }
  const latest = [...rows].reverse().find((row) => row.fileCode === code && row.official) ?? rows[rows.length - 1];

  return {
    code,
    name: latest.name,
    liveCode: LIVE_CODES[code] ?? code,
    formerCodes: [...new Set(rows.map((row) => row.fileCode))].filter((fileCode) => fileCode !== code),
    index: code.startsWith("^"),
    dates: rows.map((row) => row.date),
    closes: rows.map((row) => row.close),
    segments,
    actions,
    unconfirmed,
    jumps,
    dropped: { weekend: sorted.length - weekday.length, duplicate: unique.removed, spike: clean.removed },
  };
}

export function buildMarket(files: { name: string; text: string }[]): Market {
  const byCodeRows = new Map<string, Row[]>();
  const skipped = { rights: 0, unreadable: 0, outOfYear: 0 };
  for (const file of files) {
    const parsed = parseFile(file.text, file.name);
    skipped.rights += parsed.rights;
    skipped.unreadable += parsed.unreadable;
    skipped.outOfYear += parsed.outOfYear;
    for (const row of parsed.rows) {
      const list = byCodeRows.get(row.code);
      if (list) list.push(row);
      else byCodeRows.set(row.code, [row]);
    }
  }

  const list: Series[] = [];
  const byCode = new Map<string, Series>();
  let start = Infinity;
  let end = 0;
  for (const [code, rows] of byCodeRows) {
    const series = buildSeries(code, rows);
    if (!series) continue;
    list.push(series);
    start = Math.min(start, series.dates[0]);
    end = Math.max(end, series.dates[series.dates.length - 1]);
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  for (const series of list) {
    byCode.set(series.code, series);
    for (const former of series.formerCodes) if (!byCode.has(former)) byCode.set(former, series);
    if (!byCode.has(series.liveCode)) byCode.set(series.liveCode, series);
  }
  return { start, end, files: files.map((file) => file.name), list, byCode, skipped };
}

export const DATA_DIR = path.join(process.cwd(), "nse-data");
const FILE_PATTERN = /^NSE_data_all_stocks_.*\.csv$/i;

type Cached = { signature: string; market: Market };
const cache = globalThis as unknown as { __nseHistoryV1?: Cached };

/** Re-reads the folder whenever a daily file is added or changed, so new data needs no restart. */
export function getMarket(dir = DATA_DIR): Market {
  const names = fs
    .readdirSync(dir)
    .filter((name) => FILE_PATTERN.test(name))
    .sort();
  const signature = names
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return `${name}:${stat.size}:${stat.mtimeMs}`;
    })
    .join("|");
  if (cache.__nseHistoryV1?.signature === signature) return cache.__nseHistoryV1.market;
  const market = buildMarket(names.map((name) => ({ name, text: fs.readFileSync(path.join(dir, name), "utf8") })));
  cache.__nseHistoryV1 = { signature, market };
  return market;
}

/** First session on or after the date, or -1 if the series has ended by then. */
export function sessionOnOrAfter(series: Series, date: number): number {
  let lo = 0;
  let hi = series.dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series.dates[mid] < date) lo = mid + 1;
    else hi = mid;
  }
  return lo < series.dates.length ? lo : -1;
}
