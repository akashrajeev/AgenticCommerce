import assert from "node:assert/strict";
import test from "node:test";
import {
  assignGrowthExperimentMembers,
  createGrowthExperiment,
  createOrUpdateGrowthExperimentExecution,
  deleteGrowthExperiment,
  getGrowthExperiment,
  getGrowthExperimentAssignmentsByTransactionIds,
  getGrowthExperimentExecution,
  listGrowthExperimentAssignments,
  listGrowthExperimentExecutions,
} from "./growth-experiment-persistence";

const databaseUrl = process.env.DATABASE_URL?.trim() || "";

test("growth experiment assignments survive PostgreSQL round-trip", { skip: !databaseUrl }, async () => {
  const experimentId = `it-growth-exp-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();
  try {
    await createGrowthExperiment({
      experimentId,
      campaignId: "headphone-aov",
      name: "Integration experiment",
      objective: "Validate durable treatment/control assignment.",
      createdAt,
    });

    await assignGrowthExperimentMembers([
      {
        experimentId,
        transactionId: "txn_it_treatment",
        cohort: "treatment",
        campaignId: "headphone-aov",
        sourceProductId: "hp-001",
        targetProductId: "mouse-001",
        assignedAt: createdAt,
      },
      {
        experimentId,
        transactionId: "txn_it_control",
        cohort: "control",
        campaignId: "headphone-aov",
        sourceProductId: "hp-001",
        assignedAt: createdAt,
      },
    ]);

    const restoredExperiment = await getGrowthExperiment(experimentId);
    assert.equal(restoredExperiment?.campaignId, "headphone-aov");
    assert.equal(restoredExperiment?.experimentId, experimentId);

    const assignments = await listGrowthExperimentAssignments(experimentId);
    assert.equal(assignments.length, 2);
    assert.equal(assignments.find((item) => item.transactionId === "txn_it_treatment")?.cohort, "treatment");
    assert.equal(assignments.find((item) => item.transactionId === "txn_it_control")?.cohort, "control");

    const byTransaction = await getGrowthExperimentAssignmentsByTransactionIds(["txn_it_treatment", "txn_it_control"]);
    assert.equal(byTransaction.length, 2);

    await createOrUpdateGrowthExperimentExecution({
      experimentId,
      transactionId: "txn_it_treatment",
      cohort: "treatment",
      status: "READY",
      attempt: 0,
      startedAt: createdAt,
      updatedAt: createdAt,
    });
    const ready = await getGrowthExperimentExecution(experimentId, "txn_it_treatment");
    assert.equal(ready?.status, "READY");
    assert.equal(ready?.attempt, 0);

    const pendingAt = new Date(Date.parse(createdAt) + 1_000).toISOString();
    await createOrUpdateGrowthExperimentExecution({
      experimentId,
      transactionId: "txn_it_treatment",
      cohort: "treatment",
      status: "PAYMENT_PENDING",
      attempt: 1,
      razorpayOrderId: "order_it_treatment",
      startedAt: createdAt,
      updatedAt: pendingAt,
    });
    const pending = await getGrowthExperimentExecution(experimentId, "txn_it_treatment");
    assert.equal(pending?.status, "PAYMENT_PENDING");
    assert.equal(pending?.attempt, 1);
    assert.equal(pending?.razorpayOrderId, "order_it_treatment");

    const failedAt = new Date(Date.parse(pendingAt) + 1_000).toISOString();
    await createOrUpdateGrowthExperimentExecution({
      experimentId,
      transactionId: "txn_it_treatment",
      cohort: "treatment",
      status: "FAILED",
      attempt: 2,
      lastError: "MCP_UNAVAILABLE",
      startedAt: createdAt,
      updatedAt: failedAt,
    });
    const failed = await getGrowthExperimentExecution(experimentId, "txn_it_treatment");
    assert.equal(failed?.status, "FAILED");
    assert.equal(failed?.attempt, 2);
    assert.equal(failed?.lastError, "MCP_UNAVAILABLE");

    const executions = await listGrowthExperimentExecutions(experimentId);
    assert.equal(executions.length, 1);
    assert.equal(executions[0]?.transactionId, "txn_it_treatment");
    assert.equal(executions[0]?.status, "FAILED");
  } finally {
    await deleteGrowthExperiment(experimentId);
  }
});
