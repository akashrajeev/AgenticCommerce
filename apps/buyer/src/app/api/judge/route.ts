import { NextResponse } from "next/server";

const gateway = (process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");
const merchant = (process.env.MERCHANT_INTERNAL_URL ?? "http://localhost:3000").replace(/\/$/, "");
const mcp = (process.env.MCP_INTERNAL_URL ?? "http://localhost:4100").replace(/\/$/, "");
const x402 = (process.env.X402_SERVICE_INTERNAL_URL ?? "http://localhost:4021").replace(/\/$/, "");
const token = process.env.MCP_AGENT_TOKEN ?? "";

async function getJson(url: string, init: RequestInit = {}) {
  try {
    const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(7000) });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: { error: error instanceof Error ? error.message : "UNAVAILABLE" } };
  }
}

async function mcpCall(name: string, args: Record<string, unknown>) {
  if (!token) return { ok: false, status: 0, body: { error: "MCP_AGENT_TOKEN_NOT_CONFIGURED" } };
  return getJson(`${mcp}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
      "mcp-name": name,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: `judge-${name}`, method: "tools/call", params: { name, arguments: args } }),
  });
}

function verifiedSettlement(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const result = (body as Record<string, unknown>).result;
  if (!result || typeof result !== "object") return null;
  const structured = (result as Record<string, unknown>).structuredContent;
  if (!structured || typeof structured !== "object") return null;
  const proof = structured as Record<string, unknown>;
  return proof.verified === true && proof.testMode === true ? proof : null;
}

export async function GET() {
  const [gatewayHealth, merchantHealth, mcpHealth, x402Health, x402Facilitator, protocolMatrix, transactionsBody, ordersBody] = await Promise.all([
    getJson(`${gateway}/health`),
    getJson(`${merchant}/api/health`),
    getJson(`${mcp}/health`),
    getJson(`${x402}/health`),
    getJson(`${x402}/facilitator-status`),
    getJson(`${process.env.BUYER_PUBLIC_INTERNAL_URL ?? "http://localhost:3001"}/api/protocol-router`),
    getJson(`${gateway}/v1/transactions`),
    getJson(`${gateway}/v1/merchant/orders`),
  ]);

  const rawTransactions = transactionsBody.body && typeof transactionsBody.body === "object" ? (transactionsBody.body as Record<string, unknown>).transactions : [];
  const transactions = Array.isArray(rawTransactions) ? rawTransactions.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object")) : [];
  const authorizedTransactions = transactions.filter((transaction) => transaction.state === "policy_authorized");
  const confirmedTransactions = transactions.filter((transaction) => transaction.state === "order_confirmed");

  const rawOrders = ordersBody.body && typeof ordersBody.body === "object" ? (ordersBody.body as Record<string, unknown>).orders : [];
  const orders = Array.isArray(rawOrders) ? rawOrders.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object")) : [];
  const verifiedCandidates = orders.filter((order) => typeof order.razorpayOrderId === "string" && typeof order.razorpayPaymentId === "string").slice(0, 10);
  const proofs = await Promise.all(verifiedCandidates.map(async (order) => {
    const transactionId = typeof order.transactionId === "string" ? order.transactionId : "";
    const orderId = typeof order.razorpayOrderId === "string" ? order.razorpayOrderId : "";
    const paymentId = typeof order.razorpayPaymentId === "string" ? order.razorpayPaymentId : "";
    const proof = transactionId && orderId && paymentId ? await mcpCall("mandate_razorpay_verify_settlement", { transactionId, orderId, paymentId }) : { ok: false, status: 0, body: null };
    return { order, proof };
  }));
  const verified = proofs.map((entry) => ({ ...entry, evidence: entry.proof.ok ? verifiedSettlement(entry.proof.body) : null })).filter((entry) => entry.evidence !== null);
  const verifiedPayments = verified.length;
  const growthUpliftPaise = verified.reduce((total, entry) => total + (typeof entry.order.incrementalRevenuePaise === "number" ? entry.order.incrementalRevenuePaise : 0), 0);
  const campaignVerified = verified.filter((entry) => {
    const notes = entry.evidence?.order;
    if (!notes || typeof notes !== "object") return false;
    const orderEvidence = notes as Record<string, unknown>;
    const razorpayOrderNotes = orderEvidence.notes;
    return Boolean(razorpayOrderNotes && typeof razorpayOrderNotes === "object" && typeof (razorpayOrderNotes as Record<string, unknown>).growth_campaign_id === "string" && (razorpayOrderNotes as Record<string, unknown>).growth_campaign_id);
  });
  const campaignVerifiedUpliftPaise = campaignVerified.reduce((total, entry) => total + (typeof entry.order.incrementalRevenuePaise === "number" ? entry.order.incrementalRevenuePaise : 0), 0);

  const gatewayBody = gatewayHealth.body && typeof gatewayHealth.body === "object" ? gatewayHealth.body as Record<string, unknown> : {};
  const mcpBody = mcpHealth.body && typeof mcpHealth.body === "object" ? mcpHealth.body as Record<string, unknown> : {};
  const x402Body = x402Health.body && typeof x402Health.body === "object" ? x402Health.body as Record<string, unknown> : {};
  const facilitatorBody = x402Facilitator.body && typeof x402Facilitator.body === "object" ? x402Facilitator.body as Record<string, unknown> : {};

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    testMode: gatewayBody.razorpayTestMode === true && mcpBody.razorpayTestMode === true,
    checks: [
      { key: "razorpay-test-mode", label: "Razorpay Test Mode", ok: gatewayBody.razorpayTestMode === true && mcpBody.razorpayTestMode === true, detail: gatewayBody.razorpayTestMode === true ? "rzp_test_* gate active" : "Test Mode gate not confirmed" },
      { key: "merchant", label: "Merchant agent", ok: merchantHealth.ok, detail: merchantHealth.ok ? "catalog/agent runtime reachable" : "merchant unavailable" },
      { key: "mandate", label: "MANDATE gateway", ok: gatewayHealth.ok, detail: gatewayHealth.ok ? "authorization core reachable" : "gateway unavailable" },
      { key: "mcp", label: "MCP policy facade", ok: mcpHealth.ok && mcpBody.razorpayTestMode === true, detail: mcpHealth.ok ? `MCP ${String(mcpBody.protocolVersion ?? "unknown")} · Test Mode ${mcpBody.razorpayTestMode === true ? "yes" : "no"}` : "MCP unavailable" },
      { key: "x402", label: "x402 facilitator", ok: x402Body.configured === true && facilitatorBody.reachable === true, detail: facilitatorBody.reachable === true ? "facilitator /supported reachable" : "facilitator not ready" },
      { key: "payments", label: "Razorpay-verified payments", ok: verifiedPayments > 0, detail: `${verifiedPayments}/${verifiedCandidates.length} sampled captured orders verified` },
    ],
    metrics: {
      authorizedTransactions: authorizedTransactions.length,
      confirmedTransactions: confirmedTransactions.length,
      merchantOrders: orders.length,
      razorpayVerifiedPayments: verifiedPayments,
      protocolCount: protocolMatrix.ok && protocolMatrix.body && typeof protocolMatrix.body === "object" ? ((protocolMatrix.body as Record<string, unknown>).summary as Record<string, unknown> | undefined)?.total ?? 0 : 0,
      growthUpliftPaise,
      campaignVerifiedPayments: campaignVerified.length,
      campaignVerifiedUpliftPaise,
    },
    links: { negotiation: "/negotiation", growth: "/growth", growthBatch: "/growth-batch", campaigns: `${merchant}/campaign-orchestrator`, campaignAttribution: `${merchant}/campaigns/attribution`, mcp: "/mcp/authorized", x402: "/x402", protocols: "/protocols", proof: "/proof" },
  });
}
