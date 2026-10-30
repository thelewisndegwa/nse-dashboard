/**
 * Fills missing trading days in nse-data/ from myStocks' public daily price lists.
 *
 *   npm run backfill                                   # day after the newest row on file, through yesterday
 *   npm run backfill -- --from 2025-11-01              # also fill earlier holes from that date on
 *   npm run backfill -- --from 2025-11-01 --to 2025-12-31
 *
 * Today is left to the live board because its price list keeps moving until the close.
 * The mobile price list only carries the closing price, change % and volume, so the
 * 12-month range, day low/high, previous close and Adjusted columns are written as "-".
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parsePricelist } from "../lib/live.ts";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "nse-data");
const SOURCE = "https://live.mystocks.co.ke/m/pricelist=";
const USER_AGENT = "Mozilla/5.0 (compatible; NSEDesk/1.0; +local dashboard)";
const HEADER = "Date,Code,Name,12m Low,12m High,Day Low,Day High,Day Price,Previous,Change,Change%,Volume,Adjusted Price";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Live board ticker -> ticker used in the yearly files. Keep in step with LIVE_CODE in lib/market.ts. */
const FILE_CODE = { HFCB: "HFCK" };

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
    console.error(`--${name} needs a date like 2025-11-01`);
    process.exit(1);
  }
  return value;
}

function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isWeekday(iso) {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

function nairobiToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());
}

function parseCSVLine(line) {
  const out = [];
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

function fileDate(raw) {
  const value = raw.trim();
  let match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  match = value.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (!match) return null;
  const month = MONTHS.findIndex((name) => name.toLowerCase() === match[2].toLowerCase()) + 1;
  if (!month) return null;
  const yy = Number(match[3]);
  return `${yy >= 70 ? 1900 + yy : 2000 + yy}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function csvDate(iso) {
  const [year, month, day] = iso.split("-");
  return `${Number(day)}-${MONTHS[Number(month) - 1]}-${year.slice(2)}`;
}

function csvCell(value) {
  return /[",]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Dates and latest names as lib/market.ts sees them, including its rule that rows must match the file's year. */
function readFiles() {
  const dates = new Set();
  const names = new Map();
  for (const file of fs.readdirSync(DATA_DIR).filter((name) => name.endsWith(".csv"))) {
    const fileYear = file.match(/(\d{4})/)?.[1];
    const lines = fs.readFileSync(path.join(DATA_DIR, file), "utf8").split(/\r?\n/);
    const header = parseCSVLine(lines[0] || "").map((cell) => cell.trim().toLowerCase());
    const dateIdx = header.indexOf("date");
    const codeIdx = header.indexOf("code");
    const nameIdx = header.indexOf("name");
    if (dateIdx < 0 || codeIdx < 0) continue;
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]) continue;
      const cols = parseCSVLine(lines[i]);
      const date = fileDate(cols[dateIdx] || "");
      if (!date || (fileYear && !date.startsWith(fileYear))) continue;
      dates.add(date);
      const code = (cols[codeIdx] || "").trim().toUpperCase();
      const name = (cols[nameIdx] || "").trim();
      const known = names.get(code);
      if (code && name && (!known || date >= known.date)) names.set(code, { date, name });
    }
  }
  return { dates, names };
}

async function fetchSession(date) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(SOURCE + date.replace(/-/g, ""), {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`responded ${response.status}`);
      const board = parsePricelist(await response.text(), new Date().toISOString());
      if (board.asOfISO === date && board.quotes.length < 20) throw new Error("price list was incomplete");
      return board;
    } catch (error) {
      if (attempt === 3) throw new Error(`${date}: ${error instanceof Error ? error.message : error}`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
}

async function inParallel(items, limit, task) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const { dates, names } = readFiles();
const from = option("from") ?? addDays([...dates].sort().at(-1), 1);
const to = option("to") ?? addDays(nairobiToday(), -1);

const wanted = [];
for (let date = from; date <= to; date = addDays(date, 1)) {
  if (isWeekday(date) && !dates.has(date)) wanted.push(date);
}
if (!wanted.length) {
  console.log(`Nothing to fetch: every weekday from ${from} to ${to} is already on file.`);
  process.exit(0);
}

console.log(`Fetching ${wanted.length} daily price lists from ${wanted[0]} to ${wanted.at(-1)}...`);
const results = await inParallel(wanted, 4, async (date) => {
  try {
    return { date, board: await fetchSession(date) };
  } catch (error) {
    return { date, error: error.message };
  }
});

const failed = results.filter((result) => result.error);
if (failed.length) {
  console.error(`Nothing was written. ${failed.length} day(s) could not be fetched:\n  ${failed.map((result) => result.error).join("\n  ")}`);
  process.exit(1);
}

const byYear = new Map();
const noSession = [];
for (const { date, board } of results) {
  if (board.asOfISO !== date) {
    noSession.push(date);
    continue;
  }
  const year = date.slice(0, 4);
  const entry = byYear.get(year) ?? { days: [], lines: [] };
  entry.days.push(date);
  for (const quote of board.quotes) {
    const code = FILE_CODE[quote.code] ?? quote.code;
    const name = names.get(code.toUpperCase())?.name ?? quote.name;
    const change = quote.changePct ? `${quote.changePct.toFixed(2)}%` : "-";
    const volume = quote.volume != null ? String(Math.round(quote.volume)) : "-";
    entry.lines.push(
      [csvDate(date), csvCell(code), csvCell(name), "-", "-", "-", "-", String(quote.price), "-", "-", change, volume, "-"].join(",")
    );
  }
  byYear.set(year, entry);
}

for (const [year, { days, lines }] of byYear) {
  // "-mystocks" sorts ahead of the official yearly file, so if both ever cover a day,
  // lib/market.ts keeps the official row (the one that carries the Adjusted column).
  const file = path.join(DATA_DIR, `NSE_data_all_stocks_${year}-mystocks.csv`);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const lead = !existing ? `${HEADER}\n` : existing.endsWith("\n") ? "" : "\n";
  fs.appendFileSync(file, `${lead}${lines.join("\n")}\n`);
  console.log(`  ${path.basename(file)}: +${days.length} sessions, ${days[0]} to ${days.at(-1)}`);
}
if (noSession.length) console.log(`  No session on ${noSession.join(", ")}`);
if (byYear.size) console.log("Restart `next dev` so the dashboard reloads the price files.");
