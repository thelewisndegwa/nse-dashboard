import { NextRequest, NextResponse } from "next/server";
import { getLiveBoard } from "@/lib/live";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const fresh = request.nextUrl.searchParams.get("fresh") === "1";
    const board = await getLiveBoard(fresh);
    const { source: _source, ...publicBoard } = board;
    return NextResponse.json(publicBoard);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the live pricelist";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
