import { NextResponse } from "next/server";

const X402_SERVICE_URL = (process.env.X402_INTERNAL_URL ?? "http://localhost:4021").replace(/\/$/, "");

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  const action = typeof body?.action === "string" ? body.action : "";

  if (action === "challenge") {
    try {
      const response = await fetch(`${X402_SERVICE_URL}/resource`, { cache: "no-store" });
      return NextResponse.json({ status: response.status, paymentRequired: response.headers.get("payment-required"), body: await response.json().catch(() => null) });
    } catch (error) {
      return NextResponse.json({ status: 502, body: { error: error instanceof Error ? error.message : "X402_SERVICE_UNAVAILABLE" } });
    }
  }

  if (action === "health") {
    try {
      const response = await fetch(`${X402_SERVICE_URL}/health`, { cache: "no-store" });
      return NextResponse.json({ status: response.status, body: await response.json().catch(() => null) });
    } catch (error) {
      return NextResponse.json({ status: 502, body: { error: error instanceof Error ? error.message : "X402_SERVICE_UNAVAILABLE" } });
    }
  }

  return NextResponse.json({ error: "INVALID_X402_LAB_ACTION" }, { status: 400 });
}
