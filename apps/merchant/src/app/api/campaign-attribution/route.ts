import { NextResponse } from "next/server";

const MCP_INTERNAL_URL = (process.env.MCP_INTERNAL_URL ?? "http://localhost:4100").replace(/\/$/, "");
const MCP_AGENT_TOKEN = process.env.MCP_AGENT_TOKEN ?? "";
const GATEWAY_INTERNAL_URL = (process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");

type MerchantOrder = { merchantOrderId: string; transactionId: string; amountPaise: number; baseAmountPaise: number; incrementalRevenuePaise: number; razorpayOrderId: string; razorpayPaymentId: string; createdAt: string; };

type VerifyProof = { verified?: boolean; testMode?: boolean; transactionId?: string; orderId?: string; paymentId?: string; amountPaise?: number; order?: { notes?: Record<string, string>; status?: string }; payment?: { status?: string; method?: string | null } };

function asRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }

async function gatewayJson(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${GATEWAY_INTERNAL_URL}${path}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body !== "object") throw new Error(`GATEWAY_HTTP_${response.status}`);
  return body as Record<string, unknown>;
}

async function verify(order: MerchantOrder): Promise<VerifyProof | null> {
  if (!MCP_AGENT_TOKEN || !order.razorpayOrderId || !order.razorpayPaymentId) return null;
  try {
    const response = await fetch(`${MCP_INTERNAL_URL}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${MCP_AGENT_TOKEN}`, "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "mandate_razorpay_verify_settlement" },
      body: JSON.stringify({ jsonrpc: "2.0", id: `campaign-attribution-${order.transactionId}`, method: "tools/call", params: { name: "mandate_razorpay_verify_settlement", arguments: { transactionId: order.transactionId, orderId: order.razorpayOrderId, paymentId: order.razorpayPaymentId } } }),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    const result = asRecord(body?.result);
    const proof = asRecord(result?.structuredContent) as VerifyProof | null;
    return response.ok && result?.isError !== true && proof?.verified === true && proof?.testMode === true ? proof : null;
  } catch { return null; }
}

export async function GET(request: Request) {
  try {
    const campaignId = new URL(request.url).searchParams.get("campaignId")?.trim() ?? "";
    if (!campaignId || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(campaignId)) return NextResponse.json({ error: "VALID_CAMPAIGN_ID_REQUIRED" }, { status: 400 });
    const body = await gatewayJson("/v1/merchant/orders");
    const orders = Array.isArray(body.orders) ? body.orders.map(asRecord).filter((value): value is Record<string, unknown> => value !== null) as unknown as MerchantOrder[] : [];
    const verified = [] as Array<MerchantOrder & { proof: VerifyProof }>;
    await Promise.all(orders.slice(0, 25).map(async (order) => {
      if (!order.transactionId || !order.razorpayOrderId || !order.razorpayPaymentId) return;
      const proof = await verify(order);
      if (proof && proof.order?.notes?.growth_campaign_id === campaignId) verified.push({ ...order, proof });
    }));
    verified.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const baseRevenuePaise = verified.reduce((sum, order) => sum + order.baseAmountPaise, 0);
    const realizedRevenuePaise = verified.reduce((sum, order) => sum + order.amountPaise, 0);
    const incrementalRevenuePaise = verified.reduce((sum, order) => sum + order.incrementalRevenuePaise, 0);
    const upliftPct = baseRevenuePaise > 0 ? (incrementalRevenuePaise / baseRevenuePaise) * 100 : 0;
    const methods = [...new Set(verified.map((order) => order.proof.payment?.method).filter((value): value is string => typeof value === "string"))];
    return NextResponse.json({ testModeOnly: true, campaignId, verifiedOrders: verified, metrics: { verifiedOrders: verified.length, baseRevenuePaise, realizedRevenuePaise, incrementalRevenuePaise, upliftPct, averageIncrementalRevenuePaise: verified.length ? incrementalRevenuePaise / verified.length : 0, paymentMethods: methods }, evidenceRule: "An order is attributed to this campaign only when Razorpay Test Mode is independently re-read and its authenticated order notes contain the requested growth_campaign_id." });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "CAMPAIGN_ATTRIBUTION_UNAVAILABLE" }, { status: 502 }); }
}
