import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { isMarketOpen, parsePricelist } from "../lib/live";

const html = fs.readFileSync(path.join(__dirname, "fixtures/mystocks-pricelist.html"), "utf8");

describe("parsePricelist", () => {
  const board = parsePricelist(html, "2026-10-29T12:00:00.000Z");

  it("reads the page date, tickers, prices, change, volume and inactive flag", () => {
    expect(board.asOfISO).toBe("2026-10-29");
    expect(board.quotes.map((quote) => quote.code)).toEqual(["EQTY", "NCBA", "HFCB", "SCOM", "^NASI"]);
    const scom = board.quotes.find((quote) => quote.code === "SCOM");
    expect(scom).toMatchObject({
      name: "Safaricom Plc",
      price: 33.25,
      changePct: -1.34,
      volume: 4.85e6,
      sector: "Telecommunication",
      inactive: false,
    });
    expect(scom?.previous).toBeCloseTo(33.25 / (1 - 0.0134), 3);
    expect(board.quotes.find((quote) => quote.code === "NCBA")?.inactive).toBe(true);
    expect(board.quotes.find((quote) => quote.code === "^NASI")?.index).toBe(true);
    expect(board.quotes.find((quote) => quote.code === "HFCB")?.volume).toBe(116033);
  });
});

describe("isMarketOpen", () => {
  it("is open on a weekday mid-session and closed at the weekend", () => {
    expect(isMarketOpen(new Date("2026-10-29T08:00:00Z"))).toBe(true);
    expect(isMarketOpen(new Date("2026-10-31T08:00:00Z"))).toBe(false);
  });
});
