import { NextResponse } from "next/server";
import { getCampaignOpportunities, growthCampaigns, type GrowthCampaign } from "../../../../../lib/campaigns";
import { getGrowthExperimentAssignmentsByTransactionIds } from "../../../../../lib/growth-experiment-persistence";

export const dynamic = "force-dynamic";

const GATEWAY_INTERNAL_URL = (process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");

type Transaction = Record<string, unknown>;
type CampaignOpportunity = ReturnType<typeof getCampaignOpportunities>[number];
type Candidate = {
  transactionId: string;
  authorizationId: string;
  cohort: "treatment" | "control";
  sourceProductId: string;
  targetProductId?: string;
  amountPaise: number | null;
  currency: string;
  state: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function transactions(): Promise<Transaction[]> {
  const response = await fetch(`${GATEWAY_INTERNAL_URL}/v1/transactions`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !body) throw new Error(`GATEWAY_HTTP_${response.status}`);
  return Array.isArray(body.transactions) ? body.transactions.map(record).filter((item): item is Transaction => item !== null) : [];
}

function authorization(transaction: Transaction): Record<string, unknown> | null {
  const value = record(transaction.mandateAuthorization);
  if (transaction.state !== "policy_authorized" || value?.status !== "authorized" || typeof value.authorizationId !== "string") return null;
  if (transaction.razorpayOrderId) return null;
  return value;
}

function lines(transaction: Transaction): Array<{ productId: string; quantity: number }> {
  const intent = record(transaction.intent);
  const quote = record(transaction.quote);
  const raw = Array.isArray(quote?.lineItems) ? quote.lineItems : Array.isArray(intent?.lineItems) ? intent.lineItems : [];
  return raw.map(record).filter((item): item is Record<string, unknown> => item !== null).map((item) => ({
    productId: typeof item.productId === "string" ? item.productId : "",
    quantity: typeof item.quantity === "number" ? item.quantity : 0,
  })).filter((item) => item.productId && Number.isInteger(item.quantity) && item.quantity > 0);
}

function amount(transaction: Transaction): number | null {
  const quote = record(transaction.quote);
  return typeof quote?.totalPaise === "number" ? quote.totalPaise : null;
}

function currency(transaction: Transaction): string {
  const quote = record(transaction.quote);
  return typeof quote?.currency === "string" ? quote.currency : "INR";
}

function treatmentCandidate(transaction: Transaction, opportunities: CampaignOpportunity[]): Candidate | null {
  const auth = authorization(transaction);
  if (!auth) return null;
  const transactionLines = lines(transaction);
  for (const opportunity of opportunities) {
    const expected = opportunity.type === "CROSS_SELL"
      ? new Map([[opportunity.sourceProductId, 1], [opportunity.productId, 1]])
      : new Map([[opportunity.productId, 1]]);
    if (transactionLines.length !== expected.size || !transactionLines.every((line) => expected.get(line.productId) === line.quantity)) continue;
    return {
      transactionId: String(transaction.id),
      authorizationId: String(auth.authorizationId),
      cohort: "treatment",
      sourceProductId: opportunity.sourceProductId,
      targetProductId: opportunity.productId,
      amountPaise: amount(transaction),
      currency: currency(transaction),
      state: String(transaction.state),
    };
  }
  return null;
}

function controlCandidate(transaction: Transaction, opportunities: CampaignOpportunity[]): Candidate | null {
  const auth = authorization(transaction);
  if (!auth) return null;
  const transactionLines = lines(transaction);
  if (transactionLines.length !== 1 || transactionLines[0]?.quantity !== 1) return null;
  const sourceProductId = transactionLines[0]?.productId;
  if (!sourceProductId || !new Set(opportunities.map((opportunity) => opportunity.sourceProductId)).has(sourceProductId)) return null;
  return {
    transactionId: String(transaction.id),
    authorizationId: String(auth.authorizationId),
    cohort: "control",
    sourceProductId,
    amountPaise: amount(transaction),
    currency: currency(transaction),
    state: String(transaction.state),
  };
}

function campaignPayload(campaign: GrowthCampaign) {
  return {
    id: campaign.id,
    name: campaign.name,
    objective: campaign.objective,
    strategy: campaign.strategy,
    opportunities: getCampaignOpportunities(campaign).map((opportunity) => ({
      sourceProductId: opportunity.sourceProductId,
      targetProductId: opportunity.productId,
      type: opportunity.type,
      score: opportunity.score,
      rationale: opportunity.rationale,
      incrementalRevenuePaise: opportunity.incrementalRevenuePaise,
    })),
  };
}

export async function GET(request: Request) {
  const campaignId = new URL(request.url).searchParams.get("campaignId")?.trim() ?? "";
  const campaign = growthCampaigns.find((item) => item.id === campaignId);
  if (!campaign) return NextResponse.json({ error: "GROWTH_EXPERIMENT_CAMPAIGN_NOT_FOUND" }, { status: 404 });

  try {
    const opportunities = getCampaignOpportunities(campaign);
    const byId = new Map<string, Candidate>();
    for (const transaction of await transactions()) {
      const treatment = treatmentCandidate(transaction, opportunities);
      const control = treatment ? null : controlCandidate(transaction, opportunities);
      const candidate = treatment ?? control;
      if (candidate) byId.set(candidate.transactionId, candidate);
    }
    const existing = await getGrowthExperimentAssignmentsByTransactionIds([...byId.keys()]);
    const assigned = new Set(existing.map((item) => item.transactionId));
    const available = [...byId.values()].filter((candidate) => !assigned.has(candidate.transactionId));
    const treatmentCandidates = available.filter((candidate) => candidate.cohort === "treatment");
    const controlCandidates = available.filter((candidate) => candidate.cohort === "control");
    return NextResponse.json({
      testModeOnly: true,
      persistence: "postgresql",
      campaign: campaignPayload(campaign),
      treatmentCandidates,
      controlCandidates,
      balancedBatchSize: Math.min(5, treatmentCandidates.length, controlCandidates.length),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GROWTH_EXPERIMENT_CANDIDATES_FAILED";
    return NextResponse.json({ error: message, testModeOnly: true, persistence: "postgresql" }, { status: 503 });
  }
}
