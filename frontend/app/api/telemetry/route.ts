import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    hint: "Use NEXT_PUBLIC_GATEWAY_WS_URL for live stream"
  });
}
