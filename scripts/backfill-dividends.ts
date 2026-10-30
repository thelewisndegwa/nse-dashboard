/**
 * Pulls dividend events (ex-date + gross DPS) from TradingView quote snapshots
 * and writes nse-data/dividends.csv.
 *
 *   npm run dividends
 */
import fs from "fs";
import path from "path";
import { DIVIDENDS_FILE, formatDps } from "../lib/dividends";
import { DATA_DIR, getMarket, type Series } from "../lib/history";
import { listedStocks } from "../lib/whatif";

const WS_URL = "wss://data.tradingview.com/socket.io/websocket?from=chart%2F";
const BATCH = 8;
const TIMEOUT_MS = 25_000;
const FIELDS = [
  "dividend_amount_h",
  "dividend_ex_date_h",
  "dividend_payment_date_h",
  "dividend_record_date_h",
  "dividend_type_h",
  "dividend_amount_recent",
  "dividend_ex_date_recent",
  "fundamental_currency_code",
  "currency_code",
];

type Snapshot = {
  symbol: string;
  amount: number[];
  ex: number[];
  type: string[];
  currency: string;
};

function frame(obj: object): string {
  const payload = JSON.stringify(obj);
  return `~m~${payload.length}~m~${payload}`;
}

function sessionId(): string {
  return `qs_${Math.random().toString(36).slice(2, 14)}`;
}

function nairobiIso(unix: number): string | null {
  if (!Number.isFinite(unix) || unix <= 0) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date(unix * 1000));
}

function tvSymbols(series: Series): string[] {
  const out = [`NSEKE:${series.liveCode}`];
  if (series.liveCode !== series.code) out.push(`NSEKE:${series.code}`);
  return out;
}

async function snapshot(symbols: string[]): Promise<Map<string, Record<string, unknown>>> {
  const merged = new Map<string, Record<string, unknown>>();
  for (const symbol of symbols) merged.set(symbol, {});
  const remaining = new Set(symbols);
  const session = sessionId();

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(WS_URL, {
      headers: {
        Origin: "https://www.tradingview.com",
        "User-Agent": "Mozilla/5.0 (compatible; NSEDesk/1.0; +local dashboard)",
      },
    } as unknown as string[]);
    let buffer = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      if (remaining.size) console.warn(`skip ${[...remaining].join(", ")} — no TradingView quote`);
      finish();
    }, TIMEOUT_MS);

    const handle = (payload: string) => {
      if (payload.startsWith("~h~")) {
        ws.send(`~m~${payload.length}~m~${payload}`);
        return;
      }
      let msg: { m?: string; p?: unknown[] };
      try {
        msg = JSON.parse(payload) as { m?: string; p?: unknown[] };
      } catch {
        return;
      }
      if (msg.m === "qsd") {
        const quote = msg.p?.[1] as { n?: string; v?: Record<string, unknown> } | undefined;
        if (quote?.n && quote.v && merged.has(quote.n)) Object.assign(merged.get(quote.n)!, quote.v);
      } else if (msg.m === "quote_completed") {
        const symbol = String(msg.p?.[1] ?? "");
        remaining.delete(symbol);
        if (!remaining.size) finish();
      }
    };

    ws.addEventListener("open", () => {
      ws.send(frame({ m: "set_auth_token", p: ["unauthorized_user_token"] }));
      ws.send(frame({ m: "set_locale", p: ["en", "US"] }));
      ws.send(frame({ m: "quote_create_session", p: [session] }));
      ws.send(frame({ m: "quote_set_fields", p: [session, ...FIELDS] }));
      ws.send(frame({ m: "quote_add_symbols", p: [session, ...symbols] }));
      ws.send(frame({ m: "quote_fast_symbols", p: [session, ...symbols] }));
    });
    ws.addEventListener("message", (event) => {
      buffer += typeof event.data === "string" ? event.data : String(event.data);
      while (buffer.startsWith("~m~") || buffer.includes("~m~")) {
        if (!buffer.startsWith("~m~")) {
          const start = buffer.indexOf("~m~");
          if (start < 0) {
            buffer = "";
            break;
          }
          buffer = buffer.slice(start);
        }
        const rest = buffer.slice(3);
        const sep = rest.indexOf("~m~");
        if (sep < 0) break;
        const len = Number(rest.slice(0, sep));
        const payloadStart = sep + 3;
        if (!Number.isFinite(len) || rest.length < payloadStart + len) break;
        const payload = rest.slice(payloadStart, payloadStart + len);
        buffer = rest.slice(payloadStart + len);
        handle(payload);
      }
    });
    ws.addEventListener("error", () => finish(new Error("TradingView socket error")));
    ws.addEventListener("close", () => {
      if (remaining.size) finish();
    });
  });

  return merged;
}

function eventsFrom(symbol: string, values: Record<string, unknown>): Snapshot {
  const amount = Array.isArray(values.dividend_amount_h) ? (values.dividend_amount_h as number[]) : [];
  const ex = Array.isArray(values.dividend_ex_date_h) ? (values.dividend_ex_date_h as number[]) : [];
  const type = Array.isArray(values.dividend_type_h) ? (values.dividend_type_h as string[]) : [];
  return {
    symbol,
    amount,
    ex,
    type,
    currency: String(values.fundamental_currency_code || values.currency_code || ""),
  };
}

async function fetchBatch(symbols: string[]): Promise<Snapshot[]> {
  try {
    const values = await snapshot(symbols);
    return symbols.map((symbol) => eventsFrom(symbol, values.get(symbol) ?? {}));
  } catch (error) {
    console.warn((error as Error).message);
    return symbols.map((symbol) => eventsFrom(symbol, {}));
  }
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function main() {
  const market = getMarket();
  const listed = new Set(listedStocks(market).map((stock) => stock.code));
  const stocks = market.list.filter((series) => listed.has(series.code));
  const wanted = new Map<string, Series>();
  for (const series of stocks) {
    for (const symbol of tvSymbols(series)) {
      if (!wanted.has(symbol)) wanted.set(symbol, series);
    }
  }
  const symbols = [...wanted.keys()];
  const rows: { code: string; exDate: string; dps: number; type: string }[] = [];
  const seen = new Set<string>();
  let withHistory = 0;

  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    console.log(`TradingView ${i + 1}–${Math.min(i + BATCH, symbols.length)} of ${symbols.length}`);
    const snaps = await fetchBatch(batch);
    for (const snap of snaps) {
      const series = wanted.get(snap.symbol);
      if (!series) continue;
      if (snap.amount.length) withHistory++;
      const looksUsd = snap.currency === "USD" && snap.amount.every((n) => Number(n) > 0 && Number(n) < 0.2);
      if (looksUsd) {
        console.warn(`skip ${snap.symbol} — DPS looks like USD, not KES`);
        continue;
      }
      if (snap.currency && snap.currency !== "KES" && snap.currency !== "USD") {
        console.warn(`${snap.symbol} currency is ${snap.currency}`);
      }
      for (let k = 0; k < snap.amount.length; k++) {
        const dps = Number(snap.amount[k]);
        const exDate = nairobiIso(Number(snap.ex[k]));
        if (!Number.isFinite(dps) || dps <= 0 || !exDate) continue;
        const key = `${series.code}|${exDate}|${formatDps(dps)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ code: series.code, exDate, dps, type: String(snap.type[k] ?? "") });
      }
    }
  }

  rows.sort((a, b) => a.code.localeCompare(b.code) || a.exDate.localeCompare(b.exDate));
  const lines = ["code,exDate,dps,type", ...rows.map((row) => [row.code, row.exDate, formatDps(row.dps), csvEscape(row.type)].join(","))];
  const out = path.join(DATA_DIR, DIVIDENDS_FILE);
  fs.writeFileSync(out, `${lines.join("\n")}\n`);
  const first = rows[0]?.exDate ?? "—";
  const last = rows[rows.length - 1]?.exDate ?? "—";
  console.log(`${rows.length} dividends across ${withHistory} TradingView symbols, ${first} to ${last}`);
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
