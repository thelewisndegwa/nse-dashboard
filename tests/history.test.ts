import { describe, expect, it } from "vitest";
import { buildMarket, describeRatio, parseFileDate } from "../lib/history";

const HEADER = "Date,CODE,NAME,12m Low,12m High,Day Low,Day High,Day Price,Previous,Change,Change%,Volume,Adjust";

function csv(name: string, rows: string[]) {
  return { name, text: [HEADER, ...rows].join("\n") };
}

describe("parseFileDate", () => {
  it("reads both file date styles", () => {
    expect(parseFileDate("1/2/2007")).toBe(20070102);
    expect(parseFileDate("2-Jan-13")).toBe(20130102);
    expect(parseFileDate("31-Oct-25")).toBe(20251031);
  });
});

describe("describeRatio", () => {
  it("names splits and bonus issues the NSE way", () => {
    expect(describeRatio(10).label).toBe("10-for-1 split");
    expect(describeRatio(1.1).label).toBe("1-for-10 bonus issue");
    expect(describeRatio(1.2).label).toBe("1-for-5 bonus issue");
  });
});

describe("buildMarket", () => {
  it("drops weekend rows, duplicate rows, and a one-day spike that reverts", () => {
    const market = buildMarket([
      csv("NSE_data_all_stocks_2015.csv", [
        "6-May-15,TEST,Test,1,1,1,1,10,10,-,-,1,-",
        "7-May-15,TEST,Test,1,1,1,1,50,10,-,-,1,-",
        "8-May-15,TEST,Test,1,1,1,1,10.4,10,-,-,1,-",
        "9-May-15,TEST,Test,1,1,1,1,80,10,-,-,1,-",
        "11-May-15,TEST,Test,1,1,1,1,10.5,10,-,-,1,-",
        "11-May-15,TEST,Test,1,1,1,1,10.45,10,-,-,1,-",
      ]),
    ]);
    const series = market.byCode.get("TEST");
    expect(series?.dates).toEqual([20150506, 20150508, 20150511]);
    expect(series?.closes).toEqual([10, 10.4, 10.45]);
    expect(series?.dropped).toEqual({ weekend: 1, duplicate: 1, spike: 1 });
  });

  it("merges BBK into ABSA", () => {
    const market = buildMarket([
      csv("NSE_data_all_stocks_2012.csv", ["12/31/2012,BBK,Barclays Bank,1,1,1,1,15.75,15.75,-,-,1,-"]),
      csv("NSE_data_all_stocks_2013.csv", ["2-Jan-13,ABSA,ABSA Bank,1,1,1,1,15.7,15.7,-,-,1,-"]),
    ]);
    const abs = market.byCode.get("ABSA");
    expect(abs?.formerCodes).toContain("BBK");
    expect(market.byCode.get("BBK")).toBe(abs);
    expect(abs?.dates).toEqual([20121231, 20130102]);
  });

  it("finds the Equity 10-for-1 split on 26 Mar 2009", () => {
    const market = buildMarket([
      csv("NSE_data_all_stocks_2009.csv", [
        "3/25/2009,EQTY,Equity Bank,1,1,1,1,125,125,-,-,1,12.5",
        "3/26/2009,EQTY,Equity Bank,1,1,1,1,13.7,13.7,-,-,1,-",
      ]),
    ]);
    expect(market.byCode.get("EQTY")?.actions).toMatchObject([{ date: 20090326, ratio: 10, label: "10-for-1 split" }]);
  });

  it("finds the KCB 10-for-1 split on 3 Apr 2007", () => {
    const market = buildMarket([
      csv("NSE_data_all_stocks_2007.csv", [
        "4/2/2007,KCB,Kenya Commercial Bank,1,1,1,1,212,212,-,-,1,21.2",
        "4/3/2007,KCB,Kenya Commercial Bank,1,1,1,1,22.5,22.5,-,-,1,-",
      ]),
    ]);
    expect(market.byCode.get("KCB")?.actions).toMatchObject([{ date: 20070403, ratio: 10, label: "10-for-1 split" }]);
  });

  it("finds NIC's 1-for-10 bonus issues", () => {
    const market = buildMarket([
      csv("NSE_data_all_stocks_2010.csv", [
        "3/25/2010,NIC,NIC Bank,1,1,1,1,38.5,38.5,-,-,1,31.82",
        "3/26/2010,NIC,NIC Bank,1,1,1,1,34.25,34.25,-,-,1,31.14",
      ]),
      csv("NSE_data_all_stocks_2011.csv", [
        "4/7/2011,NIC,NIC Bank,1,1,1,1,47.75,47.75,-,-,1,43.41",
        "4/8/2011,NIC,NIC Bank,1,1,1,1,44.25,44.25,-,-,1,-",
      ]),
    ]);
    const ncba = market.byCode.get("NCBA");
    expect(ncba?.formerCodes).toContain("NIC");
    expect(ncba?.actions.map((action) => ({ date: action.date, ratio: action.ratio }))).toEqual([
      { date: 20100326, ratio: 1.1 },
      { date: 20110408, ratio: 1.1 },
    ]);
  });
});
