import { NextResponse } from "next/server";

const GATEWAY_INTERNAL_URL = process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000";
const GATEWAY_SECRET = process.env.INTERNAL_GATEWAY_SECRET ?? process.env.GATEWAY_INTERNAL_SECRET ?? "";

type Transaction = { id: string; state: string; razorpayOrderId?: string; razorpayPaymentId?: string; quote?: { totalPaise?: number } };

async function gateway(path: string, init?: RequestInit) {
  return fetch(`${GATEWAY_INTERNAL_URL}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(GATEWAY_SECRET ? { "x-mandate-gateway-secret": GATEWAY_SECRET } : {}) },
    cache: "no-store",
  });
}

export async function GET() {
  try {
    const response = await gateway("/v1/transactions");
    if (!response.ok) return NextResponse.json({ error: "TRANSACTIONS_UNAVAILABLE" }, { status: 502 });
    const body = (await response.json()) as { transactions?: Transaction[] };
    return NextResponse.json({ transactions: (body.transactions ?? []).slice(0, 12) });
  } catch {
    return NextResponse.json({ error: "WEBHOOK_LAB_UNAVAILABLE" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { transactionId?: unknown } | null;
  const transactionId = typeof body?.transactionId === "string" ? body.transactionId.trim() : "";
  if (!transactionId) return NextResponse.json({ error: "TRANSACTION_ID_REQUIRED" }, { status: 400 });

  try {
    const response = await gateway("/v1/webhooks/lab/replay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactionId }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return NextResponse.json(payload ?? { error: "WEBHOOK_REPLAY_FAILED" }, { status: response.status });
    return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "WEBHOOK_LAB_UNAVAILABLE" }, { status: 502 });
  }
}
