import { NextRequest, NextResponse } from "next/server";
import { getMarket } from "@/lib/history";
import { whatIf } from "@/lib/whatif";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code") || "";
  const date = request.nextUrl.searchParams.get("date") || "";
  try {
    const result = whatIf({ market: getMarket(), code, date, shares: 1 });
    if ("error" in result) return NextResponse.json(result, { status: 400 });
    return NextResponse.json({
      code: result.code,
      name: result.name,
      liveCode: result.liveCode,
      tradeDate: result.tradeDate,
      tradedPrice: result.tradedPrice,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not look up that price";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
