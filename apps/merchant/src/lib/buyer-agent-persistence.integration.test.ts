import assert from "node:assert/strict";
import test from "node:test";
import { loadBuyerAgentRun, persistBuyerAgentCheckpoint } from "./buyer-agent-persistence";

const databaseUrl = process.env.DATABASE_URL?.trim() || "";

test("buyer agent run and workspace survive PostgreSQL round-trip", { skip: !databaseUrl }, async () => {
  const runId = `it-buyer-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const run = {
    id: runId,
    objective: "Find useful ANC headphones",
    maxSpendPaise: 700000,
    currency: "INR" as const,
    maxSteps: 12,
    state: "BUILDING_BASKET",
    stepCount: 4,
    plannerCalls: 4,
    plannerModel: "test-planner",
    workspace: {
      selectedProductId: "hp-001",
      basket: [{ productId: "hp-001", quantity: 1 }],
      latestQuote: { quoteId: "quote-it", totalPaise: 619900, currency: "INR" },
    },
    createdAt: startedAt,
    updatedAt: new Date().toISOString(),
  };
  const step = {
    step: 4,
    state: "BUILDING_BASKET",
    tool: "build_basket",
    arguments: { lineItems: [{ productId: "hp-001", quantity: 1 }] },
    status: "succeeded",
    reason: "Construct the buyer basket.",
    output: run.workspace,
    callId: "call-it-4",
    plannerModel: "test-planner",
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: 8,
  };

  await persistBuyerAgentCheckpoint(run, step);
  const restored = await loadBuyerAgentRun(runId);
  assert.ok(restored);
  assert.equal(restored.run.id, runId);
  assert.equal(restored.run.state, "BUILDING_BASKET");
  assert.deepEqual(restored.workspace, run.workspace);
  assert.equal(restored.trace.length, 1);
  assert.equal(restored.trace[0]?.tool, "build_basket");
});
