import assert from "node:assert/strict";
import test from "node:test";
import {
  assignGrowthExperimentMembers,
  createGrowthExperiment,
  deleteGrowthExperiment,
  getGrowthExperiment,
  getGrowthExperimentAssignmentsByTransactionIds,
  listGrowthExperimentAssignments,
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
  } finally {
    await deleteGrowthExperiment(experimentId);
  }
});
