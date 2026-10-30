import type { LiveBoard, Quote } from "./types";

const SOURCE = "https://live.mystocks.co.ke/m/pricelist";
const CACHE_MS = 60_000;
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

type Cache = { at: number; board: LiveBoard };

const globalCache = globalThis as unknown as { __nseLive?: Cache };

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeTicker(value: string): string {
  let current = value.trim();
  for (let i = 0; i < 2; i++) {
    if (!current.includes("%")) break;
    try {
      const next = decodeURIComponent(current);
      if (next === current) break;
      current = next;
    } catch {
      break;
    }
  }
  return current;
}

function parsePrice(value: string): number | null {
  const n = Number.parseFloat(value.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function parseVolume(label: string): number | null {
  const raw = label.trim();
  if (!raw || raw === "-" || raw === "—") return null;
  const m = raw.match(/^([\d,.]+)\s*([kmb])?$/i);
  if (!m) return null;
  const n = Number.parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const suffix = (m[2] || "").toUpperCase();
  if (suffix === "K") return n * 1e3;
  if (suffix === "M") return n * 1e6;
  if (suffix === "B") return n * 1e9;
  return n;
}

function parseAsOf(html: string): { label: string; iso: string | null } {
  const match = html.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (!match) return { label: "Today", iso: null };
  const day = Number(match[1]);
  const month = MONTHS[match[2].toLowerCase()];
  const year = Number(match[3]);
  if (!month) return { label: `${day} ${match[2]} ${year}`, iso: null };
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { label: `${day} ${match[2]} ${year}`, iso };
}

function parseNames(html: string): Map<string, string> {
  const names = new Map<string, string>();
  const re = /<option value=([^ >]+)>([^<]*)<\/option>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const code = decodeTicker(match[1]);
    const name = decodeEntities(match[2]);
    if (!code || !name || name.startsWith("(Select")) continue;
    names.set(code, name);
  }
  return names;
}

export function parsePricelist(html: string, fetchedAt: string): LiveBoard {
  const asOf = parseAsOf(html);
  const names = parseNames(html);
  const quotes: Quote[] = [];
  const parts = html.split(/<h2>([^<]+)<\/h2>/);
  const rowRe =
    /<a href="\/m\/stock=[^"]+">([^<]+)<\/a><br>\s*<td class=n>([^<]*)<td class="n x(-?\d)">([\s\S]*?)<td class=n>([^<]*)/g;

  for (let i = 1; i < parts.length; i += 2) {
    const sector = decodeEntities(parts[i]);
    const body = parts[i + 1] || "";
    const indexSector = sector.toLowerCase() === "indices";
    rowRe.lastIndex = 0;
    let row: RegExpExecArray | null;
    while ((row = rowRe.exec(body))) {
      const code = decodeTicker(decodeEntities(row[1]));
      const price = parsePrice(row[2]);
      if (!code || price == null) continue;
      const direction = Number(row[3]);
      const changeCell = decodeEntities(row[4]);
      let changePct: number | null = 0;
      if (direction === 0) changePct = 0;
      else {
        const found = changeCell.match(/([\d.]+)\s*%/);
        changePct = found ? Math.abs(Number(found[1])) * (direction < 0 ? -1 : 1) : null;
      }
      const volumeLabel = decodeEntities(row[5]) || "—";
      const previous =
        changePct != null && changePct > -100 ? price / (1 + changePct / 100) : null;
      const inactive = /\binact\b/.test(body.slice(Math.max(0, row.index - 90), row.index));
      quotes.push({
        code,
        name: names.get(code) || code,
        sector,
        price,
        changePct,
        previous: previous != null && Number.isFinite(previous) ? Number(previous.toFixed(4)) : null,
        volumeLabel: volumeLabel === "-" ? "—" : volumeLabel,
        volume: parseVolume(volumeLabel),
        index: indexSector || code.startsWith("^"),
        inactive,
      });
    }
  }

  return {
    asOf: asOf.label,
    asOfISO: asOf.iso,
    fetchedAt,
    quotes,
    stale: false,
    source: SOURCE,
    marketOpen: isMarketOpen(),
  };
}

/** NSE cash market, weekdays about 9:00 to 15:00 East Africa Time. */
export function isMarketOpen(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!weekday || weekday === "Sat" || weekday === "Sun") return false;
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 && mins < 15 * 60;
}

export async function getLiveBoard(fresh = false): Promise<LiveBoard> {
  const cached = globalCache.__nseLive;
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) {
    return { ...cached.board, marketOpen: isMarketOpen() };
  }

  try {
    const response = await fetch(SOURCE, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NSEDesk/1.0; +local dashboard)",
        Accept: "text/html",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Pricelist responded ${response.status}`);
    const html = await response.text();
    const board = parsePricelist(html, new Date().toISOString());
    if (board.quotes.length < 20) throw new Error("Pricelist did not include a full market");
    globalCache.__nseLive = { at: Date.now(), board };
    return board;
  } catch (error) {
    if (cached) return { ...cached.board, stale: true };
    const message = error instanceof Error ? error.message : "Could not reach the live pricelist";
    throw new Error(message);
  }
}

export function quoteMap(board: LiveBoard): Map<string, Quote> {
  return new Map(board.quotes.map((quote) => [quote.code, quote]));
}
