import { NextResponse } from "next/server";

const GATEWAY = (process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");
const MERCHANT = (process.env.MERCHANT_INTERNAL_URL ?? "http://localhost:3000").replace(/\/$/, "");
const MCP = (process.env.MCP_INTERNAL_URL ?? "http://localhost:4100").replace(/\/$/, "");
const X402 = (process.env.X402_SERVICE_INTERNAL_URL ?? process.env.X402_INTERNAL_URL ?? "http://localhost:4021").replace(/\/$/, "");
const GATEWAY_SECRET = process.env.INTERNAL_GATEWAY_SECRET ?? process.env.MANDATE_INTERNAL_GATEWAY_SECRET ?? "";

async function getJson(url: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> | null; ok: boolean }> {
  try {
    const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(6000) });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    return { status: response.status, body, ok: response.ok };
  } catch { return { status: 0, body: null, ok: false }; }
}

export async function GET() {
  const headers = GATEWAY_SECRET ? { "x-mandate-gateway-secret": GATEWAY_SECRET } : undefined;
  const [gatewayHealth, razorpay, orders, merchantFunnel, mcpHealth, x402Health, x402Facilitator] = await Promise.all([
    getJson(`${GATEWAY}/health`),
    getJson(`${GATEWAY}/v1/internal/razorpay/status?deep=1`, { headers }),
    getJson(`${GATEWAY}/v1/merchant/orders`),
    getJson(`${MERCHANT}/api/campaign-orchestrator`),
    getJson(`${MCP}/health?deep=1`),
    getJson(`${X402}/health`),
    getJson(`${X402}/facilitator-status`),
  ]);

  const orderList = Array.isArray(orders.body?.orders) ? orders.body!.orders : [];
  const merchantOrders = orderList.filter((value) => value && typeof value === "object") as Array<Record<string, unknown>>;
  const verifiedRazorpayOrders = merchantOrders.filter((order) => typeof order.razorpayOrderId === "string" && typeof order.razorpayPaymentId === "string").length;
  const funnel = merchantFunnel.body?.funnel && typeof merchantFunnel.body.funnel === "object" ? merchantFunnel.body.funnel as Record<string, unknown> : null;

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    mode: { testModeRequired: true, razorpayTestMode: razorpay.body?.testMode === true && razorpay.body?.configured === true, razorpayProbe: razorpay.body?.probe ?? null },
    services: {
      gateway: { ok: gatewayHealth.ok, status: gatewayHealth.status },
      mcp: { ok: mcpHealth.ok && mcpHealth.body?.razorpayTestMode === true && mcpHealth.body?.razorpayApiReachable === true, detail: mcpHealth.body?.razorpayProbe ?? null },
      x402: { ok: x402Health.ok, facilitatorReachable: x402Facilitator.body?.reachable === true },
    },
    growth: {
      confirmedMerchantOrders: merchantOrders.length,
      razorpayLinkedOrders: verifiedRazorpayOrders,
      funnel,
    },
    links: { payment: "/negotiation", growth: "/growth", campaign: "/campaign-orchestrator", mcp: "/mcp", x402: "/x402", protocols: "/protocols" },
  }, { headers: { "cache-control": "no-store" } });
}
