import { NextResponse } from "next/server";
import {
  createOrUpdateGrowthExperimentExecution,
  getGrowthExperiment,
  listGrowthExperimentAssignments,
  listGrowthExperimentExecutions,
  type GrowthExperimentExecution,
} from "../../../../../lib/growth-experiment-persistence";

export const dynamic = "force-dynamic";

const GATEWAY_INTERNAL_URL = (process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");
const MCP_INTERNAL_URL = (process.env.MCP_INTERNAL_URL ?? "http://localhost:4100").replace(/\/$/, "");
const MCP_AGENT_TOKEN = process.env.MCP_AGENT_TOKEN ?? "";

type RecordValue = Record<string, unknown>;
type VerifiedOrder = {
  transactionId: string;
  cohort: "treatment" | "control";
  sourceProductId: string;
  targetProductId?: string;
  orderId: string;
  paymentId: string;
  amountPaise: number;
  baseAmountPaise: number;
  incrementalRevenuePaise: number;
};

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

async function gatewayJson(path: string): Promise<RecordValue> {
  const response = await fetch(`${GATEWAY_INTERNAL_URL}${path}`, { cache: "no-store", signal: AbortSignal.timeout(9000) });
  const body = await response.json().catch(() => null) as RecordValue | null;
  if (!response.ok || !body) throw new Error(`GATEWAY_HTTP_${response.status}`);
  return body;
}

async function verify(transactionId: string, orderId: string, paymentId: string): Promise<boolean> {
  if (!MCP_AGENT_TOKEN || !orderId || !paymentId) return false;
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
      body: JSON.stringify({ jsonrpc: "2.0", id: `growth-exp-evidence-${transactionId}`, method: "tools/call", params: { name: "mandate_razorpay_verify_settlement", arguments: { transactionId, orderId, paymentId } } }),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const body = await response.json().catch(() => null) as RecordValue | null;
    const result = record(body?.result);
    const proof = record(result?.structuredContent);
    return response.ok && result?.isError !== true && proof?.verified === true && proof?.testMode === true;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const experimentId = new URL(request.url).searchParams.get("experimentId")?.trim() ?? "";
  if (!experimentId) return NextResponse.json({ error: "EXPERIMENT_ID_REQUIRED" }, { status: 400 });

  try {
    const experiment = await getGrowthExperiment(experimentId);
    if (!experiment) return NextResponse.json({ error: "GROWTH_EXPERIMENT_NOT_FOUND" }, { status: 404 });
    const [assignments, transactionsBody, ordersBody] = await Promise.all([
      listGrowthExperimentAssignments(experimentId),
      gatewayJson("/v1/transactions"),
      gatewayJson("/v1/merchant/orders"),
    ]);
    const transactions = Array.isArray(transactionsBody.transactions) ? transactionsBody.transactions.map(record).filter((value): value is RecordValue => value !== null) : [];
    const orders = Array.isArray(ordersBody.orders) ? ordersBody.orders.map(record).filter((value): value is RecordValue => value !== null) : [];
    const transactionById = new Map(transactions.map((transaction) => [String(transaction.id), transaction]));
    const orderByTransactionId = new Map(orders.map((order) => [String(order.transactionId), order]));
    const verifiedOrders: VerifiedOrder[] = [];
    const checks = await Promise.all(assignments.map(async (assignment) => {
      const transaction = transactionById.get(assignment.transactionId);
      const merchantOrder = orderByTransactionId.get(assignment.transactionId);
      const orderId = typeof merchantOrder?.razorpayOrderId === "string" ? merchantOrder.razorpayOrderId : typeof transaction?.razorpayOrderId === "string" ? transaction.razorpayOrderId : "";
      const paymentId = typeof merchantOrder?.razorpayPaymentId === "string" ? merchantOrder.razorpayPaymentId : typeof transaction?.razorpayPaymentId === "string" ? transaction.razorpayPaymentId : "";
      const verified = await verify(assignment.transactionId, orderId, paymentId);
      const existingExecution = await getExecutionSafe(experimentId, assignment.transactionId);
      const now = new Date().toISOString();
      if (verified) {
        const amountPaise = typeof merchantOrder?.amountPaise === "number" ? merchantOrder.amountPaise : typeof record(transaction?.quote)?.totalPaise === "number" ? Number(record(transaction?.quote)?.totalPaise) : 0;
        const baseAmountPaise = typeof merchantOrder?.baseAmountPaise === "number" ? merchantOrder.baseAmountPaise : amountPaise;
        const incrementalRevenuePaise = typeof merchantOrder?.incrementalRevenuePaise === "number" ? merchantOrder.incrementalRevenuePaise : Math.max(amountPaise - baseAmountPaise, 0);
        verifiedOrders.push({ transactionId: assignment.transactionId, cohort: assignment.cohort, sourceProductId: assignment.sourceProductId, ...(assignment.targetProductId ? { targetProductId: assignment.targetProductId } : {}), orderId, paymentId, amountPaise, baseAmountPaise, incrementalRevenuePaise });
        await createOrUpdateGrowthExperimentExecution({
          experimentId,
          transactionId: assignment.transactionId,
          cohort: assignment.cohort,
          status: "CONFIRMED",
          attempt: existingExecution?.attempt ?? 0,
          razorpayOrderId: orderId,
          razorpayPaymentId: paymentId,
          startedAt: existingExecution?.startedAt ?? now,
          updatedAt: now,
        });
        return { assignment, verified: true, status: "CONFIRMED" };
      }

      const transactionState = typeof transaction?.state === "string" ? transaction.state : "";
      if (transactionState === "payment_failed" || transactionState === "cancelled") {
        await createOrUpdateGrowthExperimentExecution({
          experimentId,
          transactionId: assignment.transactionId,
          cohort: assignment.cohort,
          status: "RECOVERY_READY",
          attempt: existingExecution?.attempt ?? 0,
          ...(orderId ? { razorpayOrderId: orderId } : {}),
          ...(paymentId ? { razorpayPaymentId: paymentId } : {}),
          lastError: transactionState === "payment_failed" ? "UNDERLYING_PAYMENT_FAILED_REQUIRES_FRESH_TRANSACTION" : "UNDERLYING_TRANSACTION_CANCELLED_REQUIRES_FRESH_TRANSACTION",
          startedAt: existingExecution?.startedAt ?? now,
          updatedAt: now,
        });
        return { assignment, verified: false, status: "RECOVERY_READY" };
      }

      return { assignment, verified: false, status: existingExecution?.status ?? "PAYMENT_PENDING" };
    }));

    const treatment = verifiedOrders.filter((order) => order.cohort === "treatment");
    const control = verifiedOrders.filter((order) => order.cohort === "control");
    const treatmentAmount = treatment.reduce((sum, order) => sum + order.amountPaise, 0);
    const controlAmount = control.reduce((sum, order) => sum + order.amountPaise, 0);
    const treatmentAov = treatment.length ? treatmentAmount / treatment.length : null;
    const controlAov = control.length ? controlAmount / control.length : null;
    const observedAovUpliftPercent = treatmentAov !== null && controlAov && controlAov > 0 ? ((treatmentAov - controlAov) / controlAov) * 100 : null;
    const incrementalRevenuePerTreatmentOrder = treatment.length ? treatment.reduce((sum, order) => sum + order.incrementalRevenuePaise, 0) / treatment.length : null;
    const executions = await listGrowthExperimentExecutions(experimentId);

    return NextResponse.json({
      testModeOnly: true,
      independentlyVerified: true,
      experiment,
      assignments,
      executions,
      checks,
      verifiedOrders,
      metrics: {
        assignedTreatment: assignments.filter((item) => item.cohort === "treatment").length,
        assignedControl: assignments.filter((item) => item.cohort === "control").length,
        verifiedTreatment: treatment.length,
        verifiedControl: control.length,
        treatmentAovPaise: treatmentAov,
        controlAovPaise: controlAov,
        observedAovUpliftPercent,
        incrementalRevenuePerTreatmentOrderPaise: incrementalRevenuePerTreatmentOrder,
        realizedIncrementalRevenuePaise: treatment.reduce((sum, order) => sum + order.incrementalRevenuePaise, 0),
        treatmentVerificationRate: assignments.filter((item) => item.cohort === "treatment").length > 0 ? treatment.length / assignments.filter((item) => item.cohort === "treatment").length * 100 : 0,
        controlVerificationRate: assignments.filter((item) => item.cohort === "control").length > 0 ? control.length / assignments.filter((item) => item.cohort === "control").length * 100 : 0,
      },
      interpretation: "Observed Test Mode AOV difference only. This is not a causal marketing claim; it becomes evidence-backed only for independently verified Razorpay Test Mode payments linked to the persisted experiment assignments.",
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GROWTH_EXPERIMENT_EVIDENCE_FAILED";
    return NextResponse.json({ error: message, testModeOnly: true }, { status: message === "GROWTH_EXPERIMENT_PERSISTENCE_NOT_CONFIGURED" ? 503 : 502 });
  }
}

async function getExecutionSafe(experimentId: string, transactionId: string): Promise<GrowthExperimentExecution | undefined> {
  try {
    const { getGrowthExperimentExecution } = await import("../../../../../lib/growth-experiment-persistence");
    return await getGrowthExperimentExecution(experimentId, transactionId);
  } catch {
    return undefined;
  }
}
