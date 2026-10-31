import { NextRequest, NextResponse } from "next/server";
import { getMarket } from "@/lib/history";
import { getLiveBoard } from "@/lib/live";
import { whatIf, type LivePrice } from "@/lib/whatif";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code") || "";
  const date = params.get("date") || "";
  const amountRaw = params.get("amount");
  const sharesRaw = params.get("shares");
  const amount = amountRaw ? Number(amountRaw) : undefined;
  const shares = sharesRaw ? Number(sharesRaw) : undefined;

  try {
    const market = getMarket();
    const live = new Map<string, LivePrice>();
    try {
      const board = await getLiveBoard(false);
      const asOf = board.asOfISO;
      if (asOf) {
        for (const quote of board.quotes) live.set(quote.code, { price: quote.price, asOf });
      }
    } catch {
      live.clear();
    }

    const result = whatIf({
      market,
      code,
      date,
      amount: amount != null && Number.isFinite(amount) ? amount : undefined,
      shares: shares != null && Number.isFinite(shares) ? shares : undefined,
      live: live.size ? live : null,
    });
    if ("error" in result) return NextResponse.json(result, { status: 400 });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not price that trade";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
