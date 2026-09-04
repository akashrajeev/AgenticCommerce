import assert from "node:assert/strict";
import test from "node:test";
import { createBuyerAgentRun, resetBuyerAgentRunsForTests } from "./buyer-agent";
import { createBuyerAgentWorkspace } from "./buyer-agent-tools";
import { BUYER_AGENT_OFFER_EVALUATION_TOOL_NAME, executeBuyerAgentOfferEvaluationTool } from "./buyer-agent-offer-evaluation";

test.afterEach(() => resetBuyerAgentRunsForTests());

function context(maxSpendPaise = 700000) {
  const run = createBuyerAgentRun({ objective: "Find useful headphones and accessories", maxSpendPaise });
  const workspace = createBuyerAgentWorkspace();
  workspace.catalog = [{ id: "case-001", name: "Travel Case", category: "accessories", pricePaise: 49900, rating: 4.5, inventory: 5, features: ["Protective"], specifications: {} }];
  workspace.recommendations = [{ productId: "case-001", type: "CROSS_SELL", score: 0.9, rationale: "Useful protection for travel", incrementalRevenuePaise: 49900 }];
  return { run, workspace };
}

test("accepts a merchant offer only when the offer is observed, in stock and within budget", () => {
  const ctx = context();
  const result = executeBuyerAgentOfferEvaluationTool(ctx, { productId: "case-001", decision: "accept", reason: "Useful protection and comfortably inside the user's limit." });
  assert.equal(result.tool, BUYER_AGENT_OFFER_EVALUATION_TOOL_NAME);
  assert.equal((result.result as { status: string }).status, "ACCEPTED");
  assert.equal((result.result as { nextAction: string }).nextAction, "BUILD_BASKET_OR_REFRESH_QUOTE");
});

test("supports explicit rejection without mutating payment state", () => {
  const ctx = context();
  const result = executeBuyerAgentOfferEvaluationTool(ctx, { productId: "case-001", decision: "reject", reason: "The accessory is not necessary for this request." });
  assert.equal((result.result as { status: string }).status, "REJECTED");
  assert.equal(ctx.workspace.basket.length, 0);
});

test("rejects accepting an unobserved merchant offer", () => {
  const ctx = context();
  assert.throws(() => executeBuyerAgentOfferEvaluationTool(ctx, { productId: "unknown", decision: "accept", reason: "Useful" }), /BUYER_AGENT_OFFER_NOT_OBSERVED/);
});

test("rejects accepting an offer that exceeds the immutable buyer limit", () => {
  const ctx = context(40000);
  assert.throws(() => executeBuyerAgentOfferEvaluationTool(ctx, { productId: "case-001", decision: "accept", reason: "Useful" }), /BUYER_AGENT_BUDGET_EXCEEDED/);
});
