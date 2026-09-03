import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";

const GATEWAY_INTERNAL_URL = process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000";
const WEBHOOK_GATEWAY_URL = process.env.WEBHOOK_GATEWAY_URL ?? GATEWAY_INTERNAL_URL;
const GATEWAY_SECRET = process.env.INTERNAL_GATEWAY_SECRET ?? process.env.GATEWAY_INTERNAL_SECRET ?? "";
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";

type Transaction = { id: string; state: string; razorpayOrderId?: string; razorpayPaymentId?: string; quote?: { totalPaise?: number } };
type ReplayResponse = { received?: boolean; duplicate?: boolean; event?: string; matchedTransaction?: boolean; error?: string };

async function gateway(path: string, init?: RequestInit, baseUrl = GATEWAY_INTERNAL_URL) {
  return fetch(`${baseUrl}${path}`, {
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
  const body = (await request.json().catch(() => null)) as { transactionId?: unknown; mode?: unknown } | null;
  const transactionId = typeof body?.transactionId === "string" ? body.transactionId.trim() : "";
  if (!transactionId) return NextResponse.json({ error: "TRANSACTION_ID_REQUIRED" }, { status: 400 });

  try {
    const transactionResponse = await gateway(`/v1/transactions/${encodeURIComponent(transactionId)}`);
    const transactionBody = await transactionResponse.json().catch(() => null) as { transaction?: Transaction; error?: string } | null;
    if (!transactionResponse.ok || !transactionBody?.transaction) return NextResponse.json({ error: transactionBody?.error ?? "TRANSACTION_NOT_FOUND" }, { status: transactionResponse.status || 404 });
    const transaction = transactionBody.transaction;

    const canUseSignedWebhook = Boolean(RAZORPAY_WEBHOOK_SECRET && transaction.razorpayOrderId && transaction.razorpayPaymentId && (body?.mode === "signed-webhook" || body?.mode === undefined));
    if (canUseSignedWebhook) {
      const dedupeKey = `webhook_lab_${transactionId}_${Date.now()}`;
      const rawBody = JSON.stringify({
        event: "payment.captured",
        payload: { payment: { entity: { id: transaction.razorpayPaymentId, order_id: transaction.razorpayOrderId } } },
      });
      const signature = createHmac("sha256", RAZORPAY_WEBHOOK_SECRET).update(rawBody, "utf8").digest("hex");
      const headers = {
        "content-type": "application/json",
        "x-razorpay-signature": signature,
        "x-razorpay-event-id": dedupeKey,
      };
      const firstResponse = await gateway("/v1/webhooks/razorpay", { method: "POST", headers, body: rawBody }, WEBHOOK_GATEWAY_URL);
      const first = await firstResponse.json().catch(() => null) as ReplayResponse | null;
      const secondResponse = await gateway("/v1/webhooks/razorpay", { method: "POST", headers, body: rawBody }, WEBHOOK_GATEWAY_URL);
      const second = await secondResponse.json().catch(() => null) as ReplayResponse | null;
      if (!firstResponse.ok) return NextResponse.json({ error: first?.error ?? "SIGNED_WEBHOOK_REPLAY_FAILED", mode: "signed-webhook", first, second }, { status: firstResponse.status });
      if (!secondResponse.ok) return NextResponse.json({ error: second?.error ?? "SIGNED_WEBHOOK_REPLAY_FAILED", mode: "signed-webhook", first, second }, { status: secondResponse.status });
      return NextResponse.json({
        mode: "signed-webhook",
        transactionId,
        dedupeKey,
        firstDelivery: first?.duplicate ? "DUPLICATE" : "ACCEPTED",
        secondDelivery: second?.duplicate ? "DUPLICATE" : "ACCEPTED",
        signatureVerified: first?.received === true && second?.received === true,
        matchedTransaction: Boolean(first?.matchedTransaction),
        stateBefore: transaction.state,
        stateAfter: first?.matchedTransaction
          ? ((await gateway(`/v1/transactions/${encodeURIComponent(transactionId)}`)).json() as { transaction?: Transaction }).transaction?.state ?? transaction.state
          : transaction.state,
      });
    }

    const response = await gateway("/v1/webhooks/lab/replay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactionId }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return NextResponse.json(payload ?? { error: "WEBHOOK_REPLAY_FAILED" }, { status: response.status });
    return NextResponse.json({ ...payload, mode: "internal-dedupe" }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "WEBHOOK_LAB_UNAVAILABLE" }, { status: 502 });
  }
}
