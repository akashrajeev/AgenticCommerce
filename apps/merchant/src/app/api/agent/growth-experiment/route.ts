import { NextResponse } from "next/server";
import { getCampaignOpportunities, growthCampaigns, type GrowthCampaign } from "../../../../lib/campaigns";
import {
  assignGrowthExperimentMembers,
  createGrowthExperiment,
  getGrowthExperiment,
  getGrowthExperimentAssignmentsByTransactionIds,
  listGrowthExperimentAssignments,
  listGrowthExperiments,
  type GrowthExperimentAssignment,
  type GrowthExperimentCohort,
} from "../../../../lib/growth-experiment-persistence";

export const dynamic = "force-dynamic";

const GATEWAY_INTERNAL_URL = (process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");

type Transaction = Record<string, unknown>;
type CampaignOpportunity = ReturnType<typeof getCampaignOpportunities>[number];

type Candidate = {
  transactionId: string;
  authorizationId: string;
  cohort: GrowthExperimentCohort;
  sourceProductId: string;
  targetProductId?: string;
  amountPaise: number | null;
  currency: string;
  state: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function gatewayTransactions(): Promise<Transaction[]> {
  const response = await fetch(`${GATEWAY_INTERNAL_URL}/v1/transactions`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !body) throw new Error(`GATEWAY_HTTP_${response.status}`);
  return Array.isArray(body.transactions)
    ? body.transactions.map(record).filter((value): value is Transaction => value !== null)
    : [];
}

function transactionAuthorization(transaction: Transaction): Record<string, unknown> | null {
  const authorization = record(transaction.mandateAuthorization);
  if (transaction.state !== "policy_authorized" || authorization?.status !== "authorized" || typeof authorization.authorizationId !== "string") return null;
  if (transaction.razorpayOrderId) return null;
  return authorization;
}

function quoteLineItems(transaction: Transaction): Array<{ productId: string; quantity: number }> {
  const intent = record(transaction.intent);
  const quote = record(transaction.quote);
  const raw = Array.isArray(quote?.lineItems) ? quote.lineItems : Array.isArray(intent?.lineItems) ? intent.lineItems : [];
  return raw.map(record).filter((line): line is Record<string, unknown> => line !== null).map((line) => ({
    productId: typeof line.productId === "string" ? line.productId : "",
    quantity: typeof line.quantity === "number" ? line.quantity : 0,
  })).filter((line) => Boolean(line.productId) && Number.isInteger(line.quantity) && line.quantity > 0);
}

function amountPaise(transaction: Transaction): number | null {
  const quote = record(transaction.quote);
  return typeof quote?.totalPaise === "number" ? quote.totalPaise : null;
}

function currency(transaction: Transaction): string {
  const quote = record(transaction.quote);
  return typeof quote?.currency === "string" ? quote.currency : "INR";
}

function matchesTreatment(transaction: Transaction, opportunities: CampaignOpportunity[]): Candidate | null {
  const authorization = transactionAuthorization(transaction);
  if (!authorization) return null;
  const lines = quoteLineItems(transaction);
  for (const opportunity of opportunities) {
    const expected = opportunity.type === "CROSS_SELL"
      ? new Map([[opportunity.sourceProductId, 1], [opportunity.productId, 1]])
      : new Map([[opportunity.productId, 1]]);
    if (lines.length !== expected.size) continue;
    const exact = lines.every((line) => expected.get(line.productId) === line.quantity);
    if (!exact) continue;
    return {
      transactionId: String(transaction.id),
      authorizationId: String(authorization.authorizationId),
      cohort: "treatment",
      sourceProductId: opportunity.sourceProductId,
      targetProductId: opportunity.productId,
      amountPaise: amountPaise(transaction),
      currency: currency(transaction),
      state: String(transaction.state),
    };
  }
  return null;
}

function matchesControl(transaction: Transaction, opportunities: CampaignOpportunity[]): Candidate | null {
  const authorization = transactionAuthorization(transaction);
  if (!authorization) return null;
  const lines = quoteLineItems(transaction);
  if (lines.length !== 1 || lines[0]?.quantity !== 1) return null;
  const sourceProductIds = new Set(opportunities.map((opportunity) => opportunity.sourceProductId));
  const sourceProductId = lines[0]?.productId;
  if (!sourceProductId || !sourceProductIds.has(sourceProductId)) return null;
  return {
    transactionId: String(transaction.id),
    authorizationId: String(authorization.authorizationId),
    cohort: "control",
    sourceProductId,
    amountPaise: amountPaise(transaction),
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

function experimentIdFrom(campaignId: string): string {
  return `growth-exp-${campaignId}-${Date.now().toString(36)}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedExperimentId = searchParams.get("experimentId")?.trim();
  try {
    if (requestedExperimentId) {
      const experiment = await getGrowthExperiment(requestedExperimentId);
      if (!experiment) return NextResponse.json({ error: "GROWTH_EXPERIMENT_NOT_FOUND" }, { status: 404 });
      const assignments = await listGrowthExperimentAssignments(requestedExperimentId);
      return NextResponse.json({ testModeOnly: true, persistence: "postgresql", experiment, assignments });
    }
    const experiments = await listGrowthExperiments();
    const summaries = await Promise.all(experiments.map(async (experiment) => {
      const assignments = await listGrowthExperimentAssignments(experiment.experimentId);
      return {
        ...experiment,
        treatment: assignments.filter((item) => item.cohort === "treatment").length,
        control: assignments.filter((item) => item.cohort === "control").length,
        assignments,
      };
    }));
    return NextResponse.json({ testModeOnly: true, persistence: "postgresql", experiments: summaries });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "GROWTH_EXPERIMENT_PERSISTENCE_FAILED" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    experimentId?: unknown;
    campaignId?: unknown;
    name?: unknown;
    objective?: unknown;
    treatmentTransactionIds?: unknown;
    controlTransactionIds?: unknown;
  } | null;

  const campaignId = typeof body?.campaignId === "string" ? body.campaignId.trim() : "";
  const campaign = growthCampaigns.find((item) => item.id === campaignId);
  if (!campaign) return NextResponse.json({ error: "GROWTH_EXPERIMENT_CAMPAIGN_NOT_FOUND" }, { status: 400 });

  const treatmentIds = Array.isArray(body?.treatmentTransactionIds)
    ? [...new Set(body.treatmentTransactionIds.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim()))]
    : [];
  const controlIds = Array.isArray(body?.controlTransactionIds)
    ? [...new Set(body.controlTransactionIds.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim()))]
    : [];
  if (treatmentIds.length < 1 || controlIds.length < 1 || treatmentIds.length !== controlIds.length || treatmentIds.length > 20) {
    return NextResponse.json({ error: "EXPERIMENT_REQUIRES_EQUAL_1_TO_20_TREATMENT_AND_CONTROL_MEMBERS" }, { status: 400 });
  }

  const experimentId = typeof body?.experimentId === "string" && body.experimentId.trim() ? body.experimentId.trim() : experimentIdFrom(campaign.id);
  if (!/^[a-z0-9][a-z0-9-]{3,79}$/.test(experimentId)) return NextResponse.json({ error: "INVALID_EXPERIMENT_ID" }, { status: 400 });
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : `${campaign.name} · Test Mode A/B`;
  const objective = typeof body?.objective === "string" && body.objective.trim() ? body.objective.trim().slice(0, 240) : `Measure observed basket-value uplift from the ${campaign.name} growth intervention.`;

  try {
    const transactions = await gatewayTransactions();
    const opportunities = getCampaignOpportunities(campaign);
    const allCandidates = new Map<string, Candidate>();
    for (const transaction of transactions) {
      const treatment = matchesTreatment(transaction, opportunities);
      const control = treatment ? null : matchesControl(transaction, opportunities);
      const candidate = treatment ?? control;
      if (candidate) allCandidates.set(candidate.transactionId, candidate);
    }

    const requestedIds = [...treatmentIds, ...controlIds];
    if (new Set(requestedIds).size !== requestedIds.length) return NextResponse.json({ error: "EXPERIMENT_TRANSACTION_CANNOT_BE_IN_BOTH_COHORTS" }, { status: 409 });
    for (const id of requestedIds) {
      if (!allCandidates.has(id)) return NextResponse.json({ error: "EXPERIMENT_TRANSACTION_NOT_ELIGIBLE", transactionId: id }, { status: 409 });
    }

    const treatmentSourceCounts = new Map<string, number>();
    const controlSourceCounts = new Map<string, number>();
    for (const id of treatmentIds) {
      const source = allCandidates.get(id)!.sourceProductId;
      treatmentSourceCounts.set(source, (treatmentSourceCounts.get(source) ?? 0) + 1);
    }
    for (const id of controlIds) {
      const source = allCandidates.get(id)!.sourceProductId;
      controlSourceCounts.set(source, (controlSourceCounts.get(source) ?? 0) + 1);
    }
    const sourceIds = new Set([...treatmentSourceCounts.keys(), ...controlSourceCounts.keys()]);
    for (const sourceProductId of sourceIds) {
      if ((treatmentSourceCounts.get(sourceProductId) ?? 0) !== (controlSourceCounts.get(sourceProductId) ?? 0)) {
        return NextResponse.json({ error: "EXPERIMENT_SOURCE_MIX_MISMATCH", sourceProductId, treatmentCount: treatmentSourceCounts.get(sourceProductId) ?? 0, controlCount: controlSourceCounts.get(sourceProductId) ?? 0 }, { status: 409 });
      }
    }

    const existingAssignments = await getGrowthExperimentAssignmentsByTransactionIds(requestedIds);
    if (existingAssignments.length) {
      const conflicting = existingAssignments.find((assignment) => assignment.experimentId !== experimentId);
      if (conflicting) return NextResponse.json({ error: "EXPERIMENT_TRANSACTION_ALREADY_ASSIGNED", transactionId: conflicting.transactionId, experimentId: conflicting.experimentId }, { status: 409 });
      const sameExperimentDifferentCohort = existingAssignments.find((assignment) => {
        const requestedCohort: GrowthExperimentCohort = treatmentIds.includes(assignment.transactionId) ? "treatment" : "control";
        return assignment.cohort !== requestedCohort || assignment.campaignId !== campaign.id;
      });
      if (sameExperimentDifferentCohort) return NextResponse.json({ error: "EXPERIMENT_ASSIGNMENT_CONFLICT", transactionId: sameExperimentDifferentCohort.transactionId }, { status: 409 });
    }

    await createGrowthExperiment({ experimentId, campaignId: campaign.id, name, objective, createdAt: new Date().toISOString() });
    const now = new Date().toISOString();
    const assignments: GrowthExperimentAssignment[] = [
      ...treatmentIds.map((transactionId) => {
        const candidate = allCandidates.get(transactionId)!;
        return { experimentId, transactionId, cohort: "treatment" as const, campaignId: campaign.id, sourceProductId: candidate.sourceProductId, ...(candidate.targetProductId ? { targetProductId: candidate.targetProductId } : {}), assignedAt: now };
      }),
      ...controlIds.map((transactionId) => {
        const candidate = allCandidates.get(transactionId)!;
        return { experimentId, transactionId, cohort: "control" as const, campaignId: campaign.id, sourceProductId: candidate.sourceProductId, assignedAt: now };
      }),
    ];
    await assignGrowthExperimentMembers(assignments);
    return NextResponse.json({ testModeOnly: true, persistence: "postgresql", experiment: { experimentId, campaignId: campaign.id, name, objective }, assignments, next: "Launch treatment with the campaign ID and control without a campaign ID. Only independently verified Test Mode payments count toward uplift." }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GROWTH_EXPERIMENT_CREATE_FAILED";
    return NextResponse.json({ error: message, testModeOnly: true, persistence: "postgresql" }, { status: message === "GROWTH_EXPERIMENT_PERSISTENCE_NOT_CONFIGURED" ? 503 : 422 });
  }
}
