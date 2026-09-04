import { NextResponse } from "next/server";

const GATEWAY_INTERNAL_URL = process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000";
const GATEWAY_SECRET = process.env.INTERNAL_GATEWAY_SECRET ?? process.env.GATEWAY_INTERNAL_SECRET ?? "";
const MCP_INTERNAL_URL = (process.env.MCP_INTERNAL_URL ?? "http://localhost:4100").replace(/\/$/, "");
const MCP_AGENT_TOKEN = process.env.MCP_AGENT_TOKEN ?? "";

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
type RazorpayEvidence = { verified: boolean; testMode: boolean; transactionId: string; orderId: string; paymentId: string; amountPaise: number; currency: string; order: { id: string; status: string; amount: number; amountPaid: number; receipt: string }; payment: { id: string; status: string; amount: number; currency: string; orderId: string | null; method: string | null } };

async function gateway(path: string) {
  return fetch(`${GATEWAY_INTERNAL_URL}${path}`, {
    headers: GATEWAY_SECRET ? { "x-mandate-gateway-secret": GATEWAY_SECRET } : undefined,
    cache: "no-store",
  });
}

async function verifyRazorpayLive(transaction: Transaction): Promise<RazorpayEvidence | null> {
  if (!MCP_AGENT_TOKEN || !transaction.razorpayOrderId || !transaction.razorpayPaymentId) return null;
  try {
    const response = await fetch(`${MCP_INTERNAL_URL}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${MCP_AGENT_TOKEN}`,
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
        "mcp-name": "mandate_razorpay_verify_settlement",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `proof-${transaction.id}`,
        method: "tools/call",
        params: {
          name: "mandate_razorpay_verify_settlement",
          arguments: {
            transactionId: transaction.id,
            orderId: transaction.razorpayOrderId,
            paymentId: transaction.razorpayPaymentId,
          },
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.json().catch(() => null) as {
      result?: { isError?: boolean; structuredContent?: RazorpayEvidence };
    } | null;
    const evidence = body?.result?.structuredContent;
    return response.ok && body?.result?.isError !== true && evidence?.verified === true && evidence.testMode === true ? evidence : null;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const transactionsResponse = await gateway("/v1/transactions");
    if (!transactionsResponse.ok) return NextResponse.json({ error: "TRANSACTIONS_UNAVAILABLE" }, { status: 502 });
    const transactionsBody = await transactionsResponse.json() as { transactions?: Transaction[] };
    const transactions = transactionsBody.transactions ?? [];
    const candidate = transactions.find((item) => item.state === "order_confirmed") ?? transactions.find((item) => Boolean(item.razorpayOrderId || item.razorpayPaymentId)) ?? transactions[0];
    if (!candidate) return NextResponse.json({ status: "empty", message: "No transactions have been created yet.", transaction: null, events: [], merchantOrder: null, razorpayEvidence: null, summary: null });

    const [timelineResponse, ordersResponse, razorpayEvidence] = await Promise.all([
      gateway(`/v1/transactions/${encodeURIComponent(candidate.id)}/timeline`),
      gateway("/v1/merchant/orders"),
      verifyRazorpayLive(candidate),
    ]);
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
      { key: "capture", label: "Captured", done: Boolean(razorpayEvidence?.verified) && (candidate.state === "payment_captured" || candidate.state === "payment_verified" || candidate.state === "order_confirmed") },
      { key: "webhook", label: "Webhook", done: eventActions.has("WEBHOOK_RECEIVED") || eventActions.has("WEBHOOK_RECONCILIATED") },
      { key: "verified", label: "Verified", done: Boolean(razorpayEvidence?.verified) },
      { key: "order", label: "Merchant order", done: Boolean(merchantOrder) && Boolean(razorpayEvidence?.verified) },
    ];
    const confirmedOrderCount = ordersBody.revenue?.confirmedOrders ?? (ordersBody.orders?.length ?? 0);
    return NextResponse.json({
      status: candidate.state,
      transaction: candidate,
      events: timelineBody.events ?? [],
      merchantOrder,
      razorpayEvidence: razorpayEvidence ?? { verified: false, testMode: false, transactionId: candidate.id, orderId: candidate.razorpayOrderId ?? "", paymentId: candidate.razorpayPaymentId ?? "", amountPaise: candidate.quote.totalPaise, currency: candidate.quote.currency },
      stages,
      summary: {
        baseAmountPaise: baseAmount,
        finalAmountPaise: merchandiseTotal,
        incrementalRevenuePaise: incremental,
        persistedRevenuePaise: ordersBody.revenue?.realizedIncrementalRevenuePaise ?? incremental,
        orderCount: confirmedOrderCount,
      },
    });
  } catch {
    return NextResponse.json({ error: "PROOF_UNAVAILABLE" }, { status: 502 });
  }
}
