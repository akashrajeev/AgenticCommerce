import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBuyerBudget,
  createBuyerAgentRun,
  getBuyerAgentRun,
  getBuyerAgentStateTransitions,
  recordBuyerAgentStep,
  resetBuyerAgentRunsForTests,
  transitionBuyerAgent,
} from "./buyer-agent";

test.afterEach(() => resetBuyerAgentRunsForTests());

test("creates a buyer agent run with immutable bounded constraints", () => {
  const run = createBuyerAgentRun({
    objective: "Find the best ANC headphones under ₹7,000",
    maxSpendPaise: 700000,
    maxSteps: 12,
    requiredCategory: " headphones ",
    requiredProductIds: ["hp-001", "hp-002"],
  });

  assert.match(run.id, /^bar_[a-z0-9]{20}$/);
  assert.equal(run.state, "CREATED");
  assert.equal(run.stepCount, 0);
  assert.equal(run.constraints.maxSpendPaise, 700000);
  assert.equal(run.constraints.currency, "INR");
  assert.equal(run.constraints.maxSteps, 12);
  assert.equal(run.constraints.requiredCategory, "headphones");
  assert.deepEqual(run.constraints.requiredProductIds, ["hp-001", "hp-002"]);
  assert.equal(Object.isFrozen(run.constraints), true);
  assert.equal(Object.isFrozen(run.constraints.requiredProductIds), true);
});

test("rejects invalid objectives and constraints", () => {
  assert.throws(() => createBuyerAgentRun({ objective: "   ", maxSpendPaise: 700000 }), /BUYER_AGENT_OBJECTIVE_REQUIRED/);
  assert.throws(() => createBuyerAgentRun({ objective: "buy", maxSpendPaise: -1 }), /BUYER_AGENT_MAX_SPEND_INVALID/);
  assert.throws(() => createBuyerAgentRun({ objective: "buy", maxSpendPaise: 700000, maxSteps: 21 }), /BUYER_AGENT_MAX_STEPS_INVALID/);
  assert.throws(() => createBuyerAgentRun({ objective: "buy", maxSpendPaise: 700000, requiredProductIds: ["hp-001", "hp-001"] }), /BUYER_AGENT_REQUIRED_PRODUCT_IDS_DUPLICATE/);
});

test("permits only explicit buyer-agent state transitions", () => {
  const run = createBuyerAgentRun({ objective: "buy headphones", maxSpendPaise: 700000 });
  transitionBuyerAgent(run.id, "PLANNING");
  transitionBuyerAgent(run.id, "SEARCHING");
  transitionBuyerAgent(run.id, "COMPARING");
  transitionBuyerAgent(run.id, "BUILDING_BASKET");
  transitionBuyerAgent(run.id, "WAITING_FOR_APPROVAL");
  transitionBuyerAgent(run.id, "COMPLETED");
  assert.equal(getBuyerAgentRun(run.id)?.state, "COMPLETED");
  assert.throws(() => transitionBuyerAgent(run.id, "PLANNING"), /BUYER_AGENT_INVALID_TRANSITION/);
});

test("counts bounded agent steps and fails closed at the configured limit", () => {
  const run = createBuyerAgentRun({ objective: "bounded shopping", maxSpendPaise: 700000, maxSteps: 2 });
  transitionBuyerAgent(run.id, "PLANNING");
  recordBuyerAgentStep(run.id);
  recordBuyerAgentStep(run.id);
  assert.equal(getBuyerAgentRun(run.id)?.stepCount, 2);
  assert.throws(() => recordBuyerAgentStep(run.id), /BUYER_AGENT_MAX_STEPS_EXCEEDED/);
  assert.equal(getBuyerAgentRun(run.id)?.state, "FAILED");
  assert.equal(getBuyerAgentRun(run.id)?.lastError, "BUYER_AGENT_MAX_STEPS_EXCEEDED");
});

test("budget check is application-owned and never mutable by the run", () => {
  const run = createBuyerAgentRun({ objective: "budgeted shopping", maxSpendPaise: 700000 });
  assert.doesNotThrow(() => assertBuyerBudget(run, 699999));
  assert.throws(() => assertBuyerBudget(run, 700001), /BUYER_AGENT_BUDGET_EXCEEDED/);
  assert.equal(run.constraints.maxSpendPaise, 700000);
});

test("transition table is exposed read-only for the future planner", () => {
  const transitions = getBuyerAgentStateTransitions();
  assert.deepEqual(transitions.CREATED, ["PLANNING", "FAILED"]);
  assert.deepEqual(transitions.WAITING_FOR_APPROVAL, ["COMPLETED", "PLANNING", "FAILED"]);
});
