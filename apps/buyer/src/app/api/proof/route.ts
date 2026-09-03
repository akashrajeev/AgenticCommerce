import { NextResponse } from "next/server";

const GATEWAY_INTERNAL_URL = process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000";
const GATEWAY_SECRET = process.env.INTERNAL_GATEWAY_SECRET ?? process.env.GATEWAY_INTERNAL_SECRET ?? "";

type Transaction = {
  id: string;
  state: string;
  intent: { merchantId: string; productId: string; quantity: number; maxSpendPaise: number; lineItems?: Array<{ productId: string; quantity: number }> };
  quote: { totalPaise: number; currency: string; lineItems: Array<{ productId: string; quantity: number; unitPricePaise: number; lineTotalPaise: number }> };
  policy?: { decision: "ALLOW" | "BLOCK"; checks: Array<{ rule: string; result: "PASS" | "FAIL"; observed: string }> };
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
};
type AuditEvent = { id: string; action: string; actor: string; createdAt: string; reason: string; metadata?: Record<string, unknown> };
type MerchantOrder = { merchantOrderId: string; transactionId: string; amountPaise: number; baseAmountPaise: number; incrementalRevenuePaise: number; razorpayOrderId: string; razorpayPaymentId: string; lineItems?: Array<{ productId: string; quantity: number; unitPricePaise: number; lineTotalPaise: number }>; createdAt: string };

async function gateway(path: string) {
  return fetch(`${GATEWAY_INTERNAL_URL}${path}`, {
    headers: GATEWAY_SECRET ? { "x-mandate-gateway-secret": GATEWAY_SECRET } : undefined,
    cache: "no-store",
  });
}

export async function GET() {
  try {
    const transactionsResponse = await gateway("/v1/transactions");
    if (!transactionsResponse.ok) return NextResponse.json({ error: "TRANSACTIONS_UNAVAILABLE" }, { status: 502 });
    const transactionsBody = await transactionsResponse.json() as { transactions?: Transaction[] };
    const transactions = transactionsBody.transactions ?? [];
    const candidate = transactions.find((item) => item.state === "order_confirmed") ?? transactions.find((item) => Boolean(item.razorpayOrderId || item.razorpayPaymentId)) ?? transactions[0];
    if (!candidate) return NextResponse.json({ status: "empty", message: "No transactions have been created yet.", transaction: null, events: [], merchantOrder: null, summary: null });

    const [timelineResponse, ordersResponse] = await Promise.all([gateway(`/v1/transactions/${encodeURIComponent(candidate.id)}/timeline`), gateway("/v1/merchant/orders")]);
    const timelineBody = timelineResponse.ok ? await timelineResponse.json() as { events?: AuditEvent[] } : { events: [] };
    const ordersBody = ordersResponse.ok ? await ordersResponse.json() as { orders?: MerchantOrder[]; revenue?: { confirmedOrders?: number; upliftedOrders?: number; realizedIncrementalRevenuePaise?: number } } : { orders: [], revenue: undefined };
    const merchantOrder = (ordersBody.orders ?? []).find((item) => item.transactionId === candidate.id) ?? null;
    const merchandiseTotal = merchantOrder?.lineItems?.reduce((sum, item) => sum + item.lineTotalPaise, 0) ?? merchantOrder?.amountPaise ?? candidate.quote.totalPaise;
    const baseAmount = merchantOrder?.baseAmountPaise ?? (candidate.quote.lineItems[0]?.lineTotalPaise ?? merchandiseTotal);
    const incremental = merchantOrder?.incrementalRevenuePaise ?? Math.max(merchandiseTotal - baseAmount, 0);
    const eventActions = new Set((timelineBody.events ?? []).map((event) => event.action));
    const stages = [
      { key: "intent", label: "AI intent", done: eventActions.has("USER_INTENT_RECEIVED") },
      { key: "policy", label: "Policy", done: candidate.state === "policy_authorized" || candidate.state === "razorpay_order_created" || candidate.state === "checkout_started" || candidate.state === "payment_authorized" || candidate.state === "payment_captured" || candidate.state === "payment_verified" || candidate.state === "order_confirmed" },
      { key: "razorpay", label: "Razorpay", done: Boolean(candidate.razorpayOrderId) },
      { key: "capture", label: "Captured", done: candidate.state === "payment_captured" || candidate.state === "payment_verified" || candidate.state === "order_confirmed" || eventActions.has("PAYMENT_CAPTURED") },
      { key: "webhook", label: "Webhook", done: eventActions.has("WEBHOOK_RECEIVED") || eventActions.has("WEBHOOK_RECONCILIATED") },
      { key: "verified", label: "Verified", done: candidate.state === "payment_verified" || candidate.state === "order_confirmed" || eventActions.has("PAYMENT_VERIFIED") },
      { key: "order", label: "Merchant order", done: candidate.state === "order_confirmed" || Boolean(merchantOrder) },
    ];
    const confirmedOrderCount = ordersBody.revenue?.confirmedOrders ?? (ordersBody.orders?.length ?? 0);
    return NextResponse.json({ status: candidate.state, transaction: candidate, events: timelineBody.events ?? [], merchantOrder, stages, summary: { baseAmountPaise: baseAmount, finalAmountPaise: merchandiseTotal, incrementalRevenuePaise: incremental, persistedRevenuePaise: ordersBody.revenue?.realizedIncrementalRevenuePaise ?? incremental, orderCount: confirmedOrderCount } });
  } catch {
    return NextResponse.json({ error: "PROOF_UNAVAILABLE" }, { status: 502 });
  }
}
