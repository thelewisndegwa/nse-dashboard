import { describe, expect, it } from "vitest";
import { sortListedStocks } from "../lib/stocks";
import { buildMarket } from "../lib/history";
import { listedStocks } from "../lib/whatif";

const HEADER = "Date,CODE,NAME,12m Low,12m High,Day Low,Day High,Day Price,Previous,Change,Change%,Volume,Adjust";

function csv(name: string, rows: string[]) {
  return { name, text: [HEADER, ...rows].join("\n") };
}

describe("sortListedStocks", () => {
  it("pins the five most popular names, then sorts the rest A–Z", () => {
    const sorted = sortListedStocks([
      { code: "ABSA", name: "ABSA Bank Kenya Plc" },
      { code: "COOP", name: "Co-operative Bank of Kenya Ltd" },
      { code: "EABL", name: "East African Breweries Ltd" },
      { code: "EQTY", name: "Equity Group Holdings Plc" },
      { code: "KCB", name: "KCB Group Plc" },
      { code: "SCOM", name: "Safaricom Plc" },
      { code: "BAT", name: "British American Tobacco Kenya Plc" },
    ]);
    expect(sorted.map((stock) => stock.code)).toEqual(["SCOM", "EQTY", "KCB", "EABL", "COOP", "ABSA", "BAT"]);
  });
});

describe("listedStocks", () => {
  it("returns still-listed names with popular tickers first", () => {
    const market = buildMarket([
      csv("NSE_data_all_stocks_2026.csv", [
        "30-Jun-26,ABSA,ABSA Bank Kenya Plc,1,1,1,1,20,20,-,-,1,-",
        "30-Jun-26,BAT,British American Tobacco Kenya Plc,1,1,1,1,400,400,-,-,1,-",
        "30-Jun-26,COOP,Co-operative Bank of Kenya Ltd,1,1,1,1,20,20,-,-,1,-",
        "30-Jun-26,EABL,East African Breweries Ltd,1,1,1,1,200,200,-,-,1,-",
        "30-Jun-26,EQTY,Equity Group Holdings Plc,1,1,1,1,60,60,-,-,1,-",
        "30-Jun-26,KCB,KCB Group Plc,1,1,1,1,50,50,-,-,1,-",
        "30-Jun-26,SCOM,Safaricom Plc,1,1,1,1,30,30,-,-,1,-",
      ]),
    ]);
    expect(listedStocks(market).map((stock) => stock.code)).toEqual(["SCOM", "EQTY", "KCB", "EABL", "COOP", "ABSA", "BAT"]);
  });
});
