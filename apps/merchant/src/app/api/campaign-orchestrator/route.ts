import { NextResponse } from "next/server";
import { getCampaignOpportunities, growthCampaigns, type GrowthCampaign } from "../../lib/campaigns";

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

function transactionPayload(transaction: Transaction, allowedProductIds: Set<string>): MerchantTransaction | null {
  const authorization = asRecord(transaction.mandateAuthorization);
  const intent = asRecord(transaction.intent);
  const quote = asRecord(transaction.quote);
  const productId = typeof transaction.productId === "string"
    ? transaction.productId
    : typeof intent?.productId === "string" ? intent.productId : null;
  if (transaction.state !== "policy_authorized" || authorization?.status !== "authorized" || typeof authorization.authorizationId !== "string" || !productId || !allowedProductIds.has(productId)) return null;
  return {
    transactionId: String(transaction.id),
    authorizationId: String(authorization.authorizationId),
    productId,
    amountPaise: typeof quote?.totalPaise === "number" ? quote.totalPaise : null,
    state: String(transaction.state),
    razorpayOrderId: typeof transaction.razorpayOrderId === "string" ? transaction.razorpayOrderId : null,
  };
}

async function createTestOrder(authorizationId: string, transactionId: string) {
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
        params: { name: "mandate_razorpay_create_order", arguments: { authorizationId, transactionId } },
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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedCampaignId = url.searchParams.get("campaignId")?.trim();
    const campaign = growthCampaigns.find((item) => item.id === requestedCampaignId) ?? growthCampaigns[0];
    if (!campaign) return NextResponse.json({ error: "NO_GROWTH_CAMPAIGNS" }, { status: 404 });
    const opportunities = getCampaignOpportunities(campaign);
    const allowedProductIds = new Set(opportunities.map((opportunity) => opportunity.productId));
    const body = await gatewayJson("/v1/transactions");
    const raw = Array.isArray(body.transactions) ? body.transactions : [];
    const candidates = raw.map((value) => asRecord(value)).filter((value): value is Transaction => value !== null).map((transaction) => transactionPayload(transaction, allowedProductIds)).filter((value): value is MerchantTransaction => value !== null).slice(0, 12);
    return NextResponse.json({
      testModeOnly: true,
      campaign: campaignPayload(campaign),
      campaigns: growthCampaigns.map(campaignPayload),
      candidates,
      maxBatchSize: 5,
      executionRule: "Only existing MANDATE-authorized transactions matching the selected campaign opportunity can create Razorpay Test Mode orders.",
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
  const allowedProductIds = new Set(opportunities.map((opportunity) => opportunity.productId));
  const body = await gatewayJson("/v1/transactions");
  const raw = Array.isArray(body.transactions) ? body.transactions : [];
  const selected = transactionIds.map((id) => raw.map((value) => asRecord(value)).find((transaction) => transaction?.id === id)).filter((value): value is Transaction => value !== undefined && value !== null);
  const candidates = selected.map((transaction) => transactionPayload(transaction, allowedProductIds)).filter((value): value is MerchantTransaction => value !== null);
  if (candidates.length !== transactionIds.length) return NextResponse.json({ error: "CAMPAIGN_TRANSACTION_NOT_ELIGIBLE" }, { status: 409 });

  const results = [] as Array<Record<string, unknown>>;
  for (const candidate of candidates) {
    const result = await createTestOrder(candidate.authorizationId, candidate.transactionId);
    results.push({ ...candidate, ...result });
  }
  return NextResponse.json({ testModeOnly: true, campaignId, requested: transactionIds.length, results, next: "Complete the Razorpay Test Mode Checkout for each created order, then open /growth for independently verified uplift." });
}
