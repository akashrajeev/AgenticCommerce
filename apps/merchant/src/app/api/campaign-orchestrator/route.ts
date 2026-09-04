import { NextResponse } from "next/server";
import { getCampaignOpportunities, growthCampaigns, type CampaignOpportunity, type GrowthCampaign } from "../../../lib/campaigns";

const GATEWAY_INTERNAL_URL = (process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");
const MCP_INTERNAL_URL = (process.env.MCP_INTERNAL_URL ?? "http://localhost:4100").replace(/\/$/, "");
const MCP_AGENT_TOKEN = process.env.MCP_AGENT_TOKEN ?? "";

type Transaction = Record<string, unknown>;

type MerchantTransaction = {
  transactionId: string;
  authorizationId: string;
  productId: string | null;
  amountPaise: number | null;
  state: string;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  matchedOpportunity?: { sourceProductId: string; targetProductId: string };
};

type MerchantOrder = {
  merchantOrderId: string;
  transactionId: string;
  amountPaise: number;
  baseAmountPaise: number;
  incrementalRevenuePaise: number;
  razorpayOrderId: string;
  razorpayPaymentId: string;
};

type CampaignFunnel = {
  eligibleOpportunities: number;
  authorizedCandidates: number;
  razorpayOrdersCreated: number;
  razorpayVerifiedCaptures: number;
  confirmedMerchantOrders: number;
  realizedIncrementalRevenuePaise: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function gatewayJson(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${GATEWAY_INTERNAL_URL}${path}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body !== "object") throw new Error(`GATEWAY_HTTP_${response.status}`);
  return body as Record<string, unknown>;
}

function campaignPayload(campaign: GrowthCampaign) {
  return {
    id: campaign.id,
    name: campaign.name,
    objective: campaign.objective,
    strategy: campaign.strategy,
    opportunities: getCampaignOpportunities(campaign).map((opportunity) => ({
      offerTargetProductId: opportunity.productId,
      sourceProductId: opportunity.sourceProductId,
      sourceProductName: opportunity.sourceProductName,
      productName: opportunity.productName,
      score: opportunity.score,
      rationale: opportunity.rationale,
      incrementalRevenuePaise: opportunity.incrementalRevenuePaise,
    })),
  };
}

function lineItemProductIds(transaction: Transaction): string[] {
  const intent = asRecord(transaction.intent);
  const rawLineItems = Array.isArray(intent?.lineItems) ? intent.lineItems : [];
  return rawLineItems
    .map((item) => asRecord(item)?.productId)
    .filter((value): value is string => typeof value === "string");
}

function matchedCampaignOpportunity(transaction: Transaction, opportunities: CampaignOpportunity[]): CampaignOpportunity | undefined {
  const intent = asRecord(transaction.intent);
  const productId = typeof transaction.productId === "string" ? transaction.productId : typeof intent?.productId === "string" ? intent.productId : null;
  if (!productId) return undefined;
  const lineProducts = new Set(lineItemProductIds(transaction));
  return opportunities.find((opportunity) => {
    if (opportunity.type === "CROSS_SELL") {
      return productId === opportunity.sourceProductId && lineProducts.has(opportunity.productId);
    }
    return productId === opportunity.productId && (lineProducts.size === 0 || lineProducts.has(opportunity.productId));
  });
}

function transactionPayload(transaction: Transaction, opportunities: CampaignOpportunity[]): MerchantTransaction | null {
  const authorization = asRecord(transaction.mandateAuthorization);
  const intent = asRecord(transaction.intent);
  const quote = asRecord(transaction.quote);
  const productId = typeof transaction.productId === "string"
    ? transaction.productId
    : typeof intent?.productId === "string" ? intent.productId : null;
  const matched = matchedCampaignOpportunity(transaction, opportunities);
  if (transaction.state !== "policy_authorized" || authorization?.status !== "authorized" || typeof authorization.authorizationId !== "string" || !matched) return null;
  return {
    transactionId: String(transaction.id),
    authorizationId: String(authorization.authorizationId),
    productId,
    amountPaise: typeof quote?.totalPaise === "number" ? quote.totalPaise : null,
    state: String(transaction.state),
    razorpayOrderId: typeof transaction.razorpayOrderId === "string" ? transaction.razorpayOrderId : null,
    razorpayPaymentId: typeof transaction.razorpayPaymentId === "string" ? transaction.razorpayPaymentId : null,
    matchedOpportunity: { sourceProductId: matched.sourceProductId, targetProductId: matched.productId },
  };
}

async function createTestOrder(authorizationId: string, transactionId: string, campaignId: string) {
  if (!MCP_AGENT_TOKEN) return { ok: false, error: "MCP_AGENT_TOKEN_NOT_CONFIGURED" } as const;
  try {
    const response = await fetch(`${MCP_INTERNAL_URL}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${MCP_AGENT_TOKEN}`,
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
        "mcp-name": "mandate_razorpay_create_order",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `campaign-${transactionId}`,
        method: "tools/call",
        params: { name: "mandate_razorpay_create_order", arguments: { authorizationId, transactionId, campaignId } },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    const result = asRecord(body?.result);
    const isError = result?.isError === true;
    return { ok: response.ok && !isError, body, error: isError ? "MCP_TOOL_ERROR" : undefined } as const;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "MCP_UNAVAILABLE" } as const;
  }
}

async function verifyCaptured(candidate: MerchantTransaction): Promise<boolean> {
  if (!MCP_AGENT_TOKEN || !candidate.razorpayOrderId || !candidate.razorpayPaymentId) return false;
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
        id: `campaign-verify-${candidate.transactionId}`,
        method: "tools/call",
        params: {
          name: "mandate_razorpay_verify_settlement",
          arguments: { transactionId: candidate.transactionId, orderId: candidate.razorpayOrderId, paymentId: candidate.razorpayPaymentId },
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    const result = asRecord(body?.result);
    const proof = asRecord(result?.structuredContent);
    return response.ok && result?.isError !== true && proof?.verified === true && proof?.testMode === true;
  } catch {
    return false;
  }
}

async function buildFunnel(campaign: GrowthCampaign, candidates: MerchantTransaction[]): Promise<CampaignFunnel> {
  const orderCreatedCandidates = candidates.filter((candidate) => Boolean(candidate.razorpayOrderId));
  const verifiedFlags = await Promise.all(orderCreatedCandidates.map(verifyCaptured));
  const verifiedCaptures = verifiedFlags.filter(Boolean).length;
  let confirmedMerchantOrders = 0;
  let realizedIncrementalRevenuePaise = 0;
  try {
    const ordersBody = await gatewayJson("/v1/merchant/orders");
    const orders = Array.isArray(ordersBody.orders) ? ordersBody.orders.map(asRecord).filter((item): item is Record<string, unknown> => item !== null) : [];
    const selectedIds = new Set(candidates.map((candidate) => candidate.transactionId));
    for (const rawOrder of orders) {
      const order = rawOrder as Partial<MerchantOrder>;
      if (typeof order.transactionId === "string" && selectedIds.has(order.transactionId) && typeof order.incrementalRevenuePaise === "number") {
        confirmedMerchantOrders += 1;
        realizedIncrementalRevenuePaise += order.incrementalRevenuePaise;
      }
    }
  } catch {
    confirmedMerchantOrders = 0;
    realizedIncrementalRevenuePaise = 0;
  }
  return {
    eligibleOpportunities: getCampaignOpportunities(campaign).length,
    authorizedCandidates: candidates.length,
    razorpayOrdersCreated: orderCreatedCandidates.length,
    razorpayVerifiedCaptures: verifiedCaptures,
    confirmedMerchantOrders,
    realizedIncrementalRevenuePaise,
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedCampaignId = url.searchParams.get("campaignId")?.trim();
    const campaign = growthCampaigns.find((item) => item.id === requestedCampaignId) ?? growthCampaigns[0];
    if (!campaign) return NextResponse.json({ error: "NO_GROWTH_CAMPAIGNS" }, { status: 404 });
    const opportunities = getCampaignOpportunities(campaign);
    const body = await gatewayJson("/v1/transactions");
    const raw = Array.isArray(body.transactions) ? body.transactions : [];
    const candidates = raw.map((value) => asRecord(value)).filter((value): value is Transaction => value !== null).map((transaction) => transactionPayload(transaction, opportunities)).filter((value): value is MerchantTransaction => value !== null).slice(0, 12);
    const funnel = await buildFunnel(campaign, candidates);
    return NextResponse.json({
      testModeOnly: true,
      campaign: campaignPayload(campaign),
      campaigns: growthCampaigns.map(campaignPayload),
      candidates,
      funnel,
      maxBatchSize: 5,
      executionRule: "Only existing MANDATE-authorized transactions matching the selected campaign source/target opportunity can create Razorpay Test Mode orders.",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "CAMPAIGN_ORCHESTRATOR_UNAVAILABLE" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const input = await request.json().catch(() => null) as { campaignId?: unknown; transactionIds?: unknown } | null;
  const campaignId = typeof input?.campaignId === "string" ? input.campaignId.trim() : "";
  const transactionIds = Array.isArray(input?.transactionIds) ? input!.transactionIds.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim()) : [];
  if (!campaignId || transactionIds.length < 1 || transactionIds.length > 5) return NextResponse.json({ error: "CAMPAIGN_AND_1_TO_5_TRANSACTIONS_REQUIRED" }, { status: 400 });
  const campaign = growthCampaigns.find((item) => item.id === campaignId);
  if (!campaign) return NextResponse.json({ error: "CAMPAIGN_NOT_FOUND" }, { status: 404 });
  const opportunities = getCampaignOpportunities(campaign);
  const body = await gatewayJson("/v1/transactions");
  const raw = Array.isArray(body.transactions) ? body.transactions : [];
  const selected = transactionIds.map((id) => raw.map((value) => asRecord(value)).find((transaction) => transaction?.id === id)).filter((value): value is Transaction => value !== undefined && value !== null);
  const candidates = selected.map((transaction) => transactionPayload(transaction, opportunities)).filter((value): value is MerchantTransaction => value !== null);
  if (candidates.length !== transactionIds.length) return NextResponse.json({ error: "CAMPAIGN_TRANSACTION_NOT_ELIGIBLE" }, { status: 409 });

  const results = [] as Array<Record<string, unknown>>;
  for (const candidate of candidates) {
    const result = await createTestOrder(candidate.authorizationId, candidate.transactionId, campaign.id);
    results.push({ ...candidate, ...result });
  }
  return NextResponse.json({ testModeOnly: true, campaignId, requested: transactionIds.length, results, next: "Complete the Razorpay Test Mode Checkout for each created order, then open /growth or /growth-attribution for independently verified uplift." });
}
