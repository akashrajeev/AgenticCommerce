import { NextResponse } from "next/server";
import { growthCampaigns } from "../../../../../lib/campaigns";
import {
  createOrUpdateGrowthExperimentExecution,
  getGrowthExperiment,
  getGrowthExperimentExecution,
  listGrowthExperimentAssignments,
  type GrowthExperimentCohort,
  type GrowthExperimentExecution,
} from "../../../../../lib/growth-experiment-persistence";

export const dynamic = "force-dynamic";

const GATEWAY_INTERNAL_URL = (process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");
const MCP_INTERNAL_URL = (process.env.MCP_INTERNAL_URL ?? "http://localhost:4100").replace(/\/$/, "");
const MCP_AGENT_TOKEN = process.env.MCP_AGENT_TOKEN ?? "";

type RecordValue = Record<string, unknown>;

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

type OrderCreationResult =
  | (Candidate & { ok: true; transaction: unknown; order: RecordValue; checkout: unknown })
  | (Candidate & { ok: false; error: string });

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

function authorization(transaction: RecordValue): RecordValue | null {
  const value = record(transaction.mandateAuthorization);
  if (!value || value.status !== "authorized" || typeof value.authorizationId !== "string") return null;
  const state = typeof transaction.state === "string" ? transaction.state : "";
  if (!["policy_authorized", "razorpay_order_created", "checkout_started", "payment_authorized"].includes(state)) return null;
  return value;
}

function quoteLines(transaction: RecordValue): Array<{ productId: string; quantity: number }> {
  const intent = record(transaction.intent);
  const quote = record(transaction.quote);
  const raw = Array.isArray(quote?.lineItems) ? quote.lineItems : Array.isArray(intent?.lineItems) ? intent.lineItems : [];
  return raw.map(record).filter((value): value is RecordValue => value !== null).map((line) => ({
    productId: typeof line.productId === "string" ? line.productId : "",
    quantity: typeof line.quantity === "number" ? line.quantity : 0,
  })).filter((line) => line.productId && Number.isInteger(line.quantity) && line.quantity > 0);
}

function candidateForAssignment(transaction: RecordValue, assignment: { cohort: GrowthExperimentCohort; sourceProductId: string; targetProductId?: string; transactionId: string }): Candidate | null {
  const auth = authorization(transaction);
  if (!auth) return null;
  const quote = record(transaction.quote);
  const expectedLines = assignment.cohort === "treatment" && assignment.targetProductId
    ? new Map([[assignment.sourceProductId, 1], [assignment.targetProductId, 1]])
    : new Map([[assignment.sourceProductId, 1]]);
  const actual = quoteLines(transaction);
  if (actual.length !== expectedLines.size || !actual.every((line) => expectedLines.get(line.productId) === line.quantity)) return null;
  return {
    transactionId: assignment.transactionId,
    authorizationId: String(auth.authorizationId),
    cohort: assignment.cohort,
    sourceProductId: assignment.sourceProductId,
    ...(assignment.targetProductId ? { targetProductId: assignment.targetProductId } : {}),
    amountPaise: typeof quote?.totalPaise === "number" ? quote.totalPaise : null,
    currency: typeof quote?.currency === "string" ? quote.currency : "INR",
    state: String(transaction.state),
  };
}

async function gatewayTransactions(): Promise<RecordValue[]> {
  const response = await fetch(`${GATEWAY_INTERNAL_URL}/v1/transactions`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  const body = await response.json().catch(() => null) as RecordValue | null;
  if (!response.ok || !body) throw new Error(`GATEWAY_HTTP_${response.status}`);
  return Array.isArray(body.transactions) ? body.transactions.map(record).filter((value): value is RecordValue => value !== null) : [];
}

async function createOrder(candidate: Candidate, campaignId?: string): Promise<OrderCreationResult> {
  if (!MCP_AGENT_TOKEN) return { ...candidate, ok: false, error: "MCP_AGENT_TOKEN_NOT_CONFIGURED" };
  const args = { authorizationId: candidate.authorizationId, transactionId: candidate.transactionId, ...(campaignId ? { campaignId } : {}) };
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
      body: JSON.stringify({ jsonrpc: "2.0", id: `growth-experiment-launch-${candidate.cohort}-${candidate.transactionId}`, method: "tools/call", params: { name: "mandate_razorpay_create_order", arguments: args } }),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const body = await response.json().catch(() => null) as RecordValue | null;
    const result = record(body?.result);
    const structured = record(result?.structuredContent);
    if (!response.ok || result?.isError === true || !structured?.order) return { ...candidate, ok: false, error: "MCP_CREATE_ORDER_FAILED" };
    const order = record(structured.order);
    if (!order) return { ...candidate, ok: false, error: "MCP_CREATE_ORDER_INVALID" };
    return { ...candidate, ok: true, transaction: structured.transaction, order, checkout: structured.checkout };
  } catch (error) {
    return { ...candidate, ok: false, error: error instanceof Error ? error.message : "MCP_UNAVAILABLE" };
  }
}

function attemptFor(execution: GrowthExperimentExecution | undefined): number {
  return execution ? execution.attempt + 1 : 0;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { experimentId?: unknown; cohorts?: unknown } | null;
  const experimentId = typeof body?.experimentId === "string" ? body.experimentId.trim() : "";
  if (!experimentId) return NextResponse.json({ error: "EXPERIMENT_ID_REQUIRED" }, { status: 400 });

  try {
    const experiment = await getGrowthExperiment(experimentId);
    if (!experiment) return NextResponse.json({ error: "GROWTH_EXPERIMENT_NOT_FOUND" }, { status: 404 });
    const campaign = growthCampaigns.find((item) => item.id === experiment.campaignId);
    if (!campaign) return NextResponse.json({ error: "GROWTH_EXPERIMENT_CAMPAIGN_NOT_FOUND" }, { status: 422 });
    const assignments = await listGrowthExperimentAssignments(experimentId);
    if (!assignments.length) return NextResponse.json({ error: "GROWTH_EXPERIMENT_HAS_NO_ASSIGNMENTS" }, { status: 409 });
    const requestedCohorts = Array.isArray(body?.cohorts)
      ? new Set(body.cohorts.filter((value): value is string => value === "treatment" || value === "control"))
      : new Set<GrowthExperimentCohort>(["treatment", "control"]);
    const transactions = await gatewayTransactions();
    const byId = new Map(transactions.map((transaction) => [String(transaction.id), transaction]));
    const results = [];
    for (const assignment of assignments.filter((item) => requestedCohorts.has(item.cohort))) {
      const existingExecution = await getGrowthExperimentExecution(experimentId, assignment.transactionId);
      const transaction = byId.get(assignment.transactionId);
      const candidate = transaction ? candidateForAssignment(transaction, assignment) : null;

      if (!candidate) {
        if (existingExecution?.status === "PAYMENT_PENDING" || existingExecution?.status === "ORDER_CREATED" || existingExecution?.status === "CONFIRMED") {
          results.push({ ...assignment, ok: true, recovered: true, execution: existingExecution });
          continue;
        }
        const failedExecution: GrowthExperimentExecution = {
          experimentId,
          transactionId: assignment.transactionId,
          cohort: assignment.cohort,
          status: "FAILED",
          attempt: attemptFor(existingExecution),
          lastError: "EXPERIMENT_TRANSACTION_NOT_PAYMENT_READY",
          startedAt: existingExecution?.startedAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await createOrUpdateGrowthExperimentExecution(failedExecution);
        results.push({ ...assignment, ok: false, error: failedExecution.lastError, execution: failedExecution });
        continue;
      }

      const now = new Date().toISOString();
      const startedAt = existingExecution?.startedAt ?? now;
      const executionStart: GrowthExperimentExecution = {
        experimentId,
        transactionId: assignment.transactionId,
        cohort: assignment.cohort,
        status: "READY",
        attempt: attemptFor(existingExecution),
        ...(existingExecution?.razorpayOrderId ? { razorpayOrderId: existingExecution.razorpayOrderId } : {}),
        ...(existingExecution?.razorpayPaymentId ? { razorpayPaymentId: existingExecution.razorpayPaymentId } : {}),
        startedAt,
        updatedAt: now,
      };
      await createOrUpdateGrowthExperimentExecution(executionStart);

      const paymentOrder = await createOrder(candidate, assignment.cohort === "treatment" ? experiment.campaignId : undefined);
      if (!paymentOrder.ok) {
        const executionFailure: GrowthExperimentExecution = {
          ...executionStart,
          status: "FAILED",
          lastError: paymentOrder.error,
          updatedAt: new Date().toISOString(),
        };
        await createOrUpdateGrowthExperimentExecution(executionFailure);
        results.push({ ...paymentOrder, execution: executionFailure });
        continue;
      }

      const executionReady: GrowthExperimentExecution = {
        ...executionStart,
        status: "PAYMENT_PENDING",
        razorpayOrderId: paymentOrder.order.id,
        lastError: undefined,
        updatedAt: new Date().toISOString(),
      };
      await createOrUpdateGrowthExperimentExecution(executionReady);
      results.push({ ...paymentOrder, execution: executionReady });
    }
    return NextResponse.json({ testModeOnly: true, experiment, campaignId: campaign.id, requestedCohorts: [...requestedCohorts], results, recovery: "Re-run launch safely retries failed order-preparation attempts or returns existing payment-ready execution records; payment failures remain terminal at the underlying transaction and require a fresh transaction/authorization." }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GROWTH_EXPERIMENT_LAUNCH_FAILED";
    return NextResponse.json({ error: message, testModeOnly: true }, { status: message === "GROWTH_EXPERIMENT_PERSISTENCE_NOT_CONFIGURED" ? 503 : 422 });
  }
}