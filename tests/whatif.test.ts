import { describe, expect, it } from "vitest";
import { buildMarket } from "../lib/history";
import { whatIf } from "../lib/whatif";

const HEADER = "Date,CODE,NAME,12m Low,12m High,Day Low,Day High,Day Price,Previous,Change,Change%,Volume,Adjust";

function csv(name: string, rows: string[]) {
  return { name, text: [HEADER, ...rows].join("\n") };
}

describe("whatIf", () => {
  it("turns 100 Equity shares bought before the 2009 split into 1,000 shares today", () => {
    const market = buildMarket([
      csv("NSE_data_all_stocks_2009.csv", [
        "3/25/2009,EQTY,Equity Bank,1,1,1,1,125,125,-,-,1,12.5",
        "3/26/2009,EQTY,Equity Bank,1,1,1,1,13.7,13.7,-,-,1,-",
      ]),
      csv("NSE_data_all_stocks_2026.csv", ["30-Jun-26,EQTY,Equity Group Holdings Plc,1,1,1,1,67,67,-,-,1,-"]),
    ]);
    const result = whatIf({ market, code: "EQTY", date: "2009-03-25", shares: 100 });
    if ("error" in result) throw new Error(result.error);
    expect(result.sharesBought).toBe(100);
    expect(result.sharesNow).toBe(1000);
    expect(result.cost).toBe(12500);
    expect(result.value).toBe(67000);
    expect(result.steps).toMatchObject([{ date: "2009-03-26", label: "10-for-1 split", sharesBefore: 100, sharesAfter: 1000 }]);
  });

  it("turns 100 KCB shares bought before the 2007 split into 1,000 shares", () => {
    const market = buildMarket([
      csv("NSE_data_all_stocks_2007.csv", [
        "4/2/2007,KCB,Kenya Commercial Bank,1,1,1,1,212,212,-,-,1,21.2",
        "4/3/2007,KCB,Kenya Commercial Bank,1,1,1,1,22.5,22.5,-,-,1,-",
      ]),
      csv("NSE_data_all_stocks_2026.csv", ["30-Jun-26,KCB,KCB Group Plc,1,1,1,1,61.5,61.5,-,-,1,-"]),
    ]);
    const result = whatIf({ market, code: "KCB", date: "2007-04-02", shares: 100 });
    if ("error" in result) throw new Error(result.error);
    expect(result.sharesNow).toBe(1000);
    expect(result.value).toBe(61500);
  });

  it("compounds NIC 1-for-10 bonus issues after the buy date", () => {
    const market = buildMarket([
      csv("NSE_data_all_stocks_2010.csv", [
        "3/25/2010,NIC,NIC Bank,1,1,1,1,38.5,38.5,-,-,1,31.82",
        "3/26/2010,NIC,NIC Bank,1,1,1,1,34.25,34.25,-,-,1,31.14",
      ]),
      csv("NSE_data_all_stocks_2011.csv", [
        "4/7/2011,NIC,NIC Bank,1,1,1,1,47.75,47.75,-,-,1,43.41",
        "4/8/2011,NIC,NIC Bank,1,1,1,1,44.25,44.25,-,-,1,-",
      ]),
      csv("NSE_data_all_stocks_2026.csv", ["30-Jun-26,NCBA,NCBA Group Plc,1,1,1,1,88,88,-,-,1,-"]),
    ]);
    const result = whatIf({ market, code: "NIC", date: "2010-03-25", shares: 1000 });
    if ("error" in result) throw new Error(result.error);
    expect(result.code).toBe("NCBA");
    expect(result.sharesNow).toBe(1210);
    expect(result.steps.map((step) => step.sharesAfter)).toEqual([1100, 1210]);
    expect(result.value).toBe(1210 * 88);
  });

  it("adds cash dividends on later ex-dates using the shares held that day", () => {
    const market = buildMarket([
      csv("NSE_data_all_stocks_2009.csv", [
        "3/25/2009,EQTY,Equity Bank,1,1,1,1,125,125,-,-,1,12.5",
        "3/26/2009,EQTY,Equity Bank,1,1,1,1,13.7,13.7,-,-,1,-",
      ]),
      csv("NSE_data_all_stocks_2026.csv", ["30-Jun-26,EQTY,Equity Group Holdings Plc,1,1,1,1,67,67,-,-,1,-"]),
    ]);
    const dividends = new Map([
      [
        "EQTY",
        [
          { code: "EQTY", date: 20090326, dps: 1, type: "Special" },
          { code: "EQTY", date: 20100601, dps: 1.5, type: "Annual" },
        ],
      ],
    ]);
    const result = whatIf({ market, code: "EQTY", date: "2009-03-25", shares: 100, dividends });
    if ("error" in result) throw new Error(result.error);
    expect(result.sharesNow).toBe(1000);
    expect(result.dividends).toBe(1000 * 1 + 1000 * 1.5);
    expect(result.dividendCount).toBe(2);
    expect(result.value).toBe(67000 + 2500);
    expect(result.cash).toBe(0);
  });

  it("does not pay a dividend on the buy session", () => {
    const market = buildMarket([
      csv("NSE_data_all_stocks_2026.csv", [
        "29-Jun-26,SCOM,Safaricom Plc,1,1,1,1,30,30,-,-,1,-",
        "30-Jun-26,SCOM,Safaricom Plc,1,1,1,1,29,29,-,-,1,-",
      ]),
    ]);
    const dividends = new Map([["SCOM", [{ code: "SCOM", date: 20260629, dps: 1.15, type: "Semi-Annual" }]]]);
    const result = whatIf({ market, code: "SCOM", date: "2026-06-29", shares: 10, dividends });
    if ("error" in result) throw new Error(result.error);
    expect(result.dividends).toBe(0);
    expect(result.value).toBe(290);
  });

  it("buys whole shares from an amount and keeps leftover cash", () => {
    const market = buildMarket([
      csv("NSE_data_all_stocks_2026.csv", ["30-Jun-26,SCOM,Safaricom Plc,1,1,1,1,30,30,-,-,1,-"]),
    ]);
    const result = whatIf({ market, code: "SCOM", date: "2026-06-30", amount: 100 });
    if ("error" in result) throw new Error(result.error);
    expect(result.mode).toBe("amount");
    expect(result.sharesBought).toBe(3);
    expect(result.cash).toBe(10);
    expect(result.cost).toBe(100);
    expect(result.value).toBe(3 * 30 + 10);
  });

  it("warns when today's live price is more than twice the last close and no split is on file", () => {
    const market = buildMarket([
      csv("NSE_data_all_stocks_2026.csv", ["30-Jun-26,SCOM,Safaricom Plc,1,1,1,1,30,30,-,-,1,-"]),
    ]);
    const live = new Map([["SCOM", { price: 70, asOf: "2026-10-29" }]]);
    const result = whatIf({ market, code: "SCOM", date: "2026-06-30", shares: 10, live });
    if ("error" in result) throw new Error(result.error);
    expect(result.warnings.some((warning) => warning.includes("far from the last daily close"))).toBe(true);
  });

  it("does not name a dividend source or coverage start when the buy is earlier than the first payout", () => {
    const market = buildMarket([
      csv("NSE_data_all_stocks_2009.csv", ["3/25/2009,EQTY,Equity Bank,1,1,1,1,125,125,-,-,1,-"]),
      csv("NSE_data_all_stocks_2026.csv", ["30-Jun-26,EQTY,Equity Group Holdings Plc,1,1,1,1,67,67,-,-,1,-"]),
    ]);
    const dividends = new Map([["EQTY", [{ code: "EQTY", date: 20100601, dps: 1.5, type: "Annual" }]]]);
    const result = whatIf({ market, code: "EQTY", date: "2009-03-25", shares: 100, dividends });
    if ("error" in result) throw new Error(result.error);
    expect(result.dividendCount).toBe(1);
    expect(result.warnings.join(" ")).not.toMatch(/TradingView|begin on|record/i);
  });
});
