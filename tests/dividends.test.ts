import { describe, expect, it } from "vitest";
import { dividendsByCode, dividendsFor, formatDps, parseDividends } from "../lib/dividends";
import { buildMarket } from "../lib/history";

const HEADER = "Date,CODE,NAME,12m Low,12m High,Day Low,Day High,Day Price,Previous,Change,Change%,Volume,Adjust";

describe("parseDividends", () => {
  it("reads canonical rows and skips junk", () => {
    const rows = parseDividends(["code,exDate,dps,type", "SCOM,2025-03-17,1.15,Semi-Annual", "EQTY,not-a-date,1,Annual", "BAT,2024-05-02,0,Annual", ""].join("\n"));
    expect(rows).toEqual([{ code: "SCOM", date: 20250317, dps: 1.15, type: "Semi-Annual" }]);
  });
});

describe("dividendsFor", () => {
  it("follows a rename to the current ticker", () => {
    const market = buildMarket([
      {
        name: "NSE_data_all_stocks_2012.csv",
        text: [HEADER, "12/31/2012,NIC,NIC Bank,1,1,1,1,40,40,-,-,1,-"].join("\n"),
      },
      {
        name: "NSE_data_all_stocks_2013.csv",
        text: [HEADER, "2-Jan-13,NCBA,NCBA Group,1,1,1,1,40,40,-,-,1,-"].join("\n"),
      },
    ]);
    const series = market.byCode.get("NCBA");
    if (!series) throw new Error("missing NCBA");
    const byCode = dividendsByCode(parseDividends("code,exDate,dps,type\nNCBA,2024-05-02,1.75,Final\n"));
    expect(dividendsFor(series, byCode)).toHaveLength(1);
    expect(dividendsFor(market.byCode.get("NIC")!, byCode)[0].dps).toBe(1.75);
  });
});

describe("formatDps", () => {
  it("trims trailing zeros", () => {
    expect(formatDps(1.14999998)).toBe("1.15");
    expect(formatDps(2)).toBe("2");
  });
});
