import { NextResponse } from "next/server";
import { getMarket, ymdToIso } from "@/lib/history";
import { listedStocks } from "@/lib/whatif";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const market = getMarket();
    return NextResponse.json({
      historyStart: ymdToIso(market.start),
      historyEnd: ymdToIso(market.end),
      stocks: listedStocks(market),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load prices";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
