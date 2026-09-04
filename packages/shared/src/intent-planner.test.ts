import assert from "node:assert/strict";
import test from "node:test";
import { planBuyerIntent } from "./intent-planner.js";

test("deterministic planner preserves the caller hard budget", async () => {
  const plan = await planBuyerIntent("Find the best ANC headphones for travel", 500000);
  assert.equal(plan.budgetCeilingPaise, 500000);
  assert.equal(plan.category, "headphones");
  assert.equal(plan.priority, "quality");
  assert.equal(plan.source, "deterministic");
});

test("deterministic planner never invents a larger budget", async () => {
  const plan = await planBuyerIntent("Find cheap headphones under any price", 125000);
  assert.equal(plan.budgetCeilingPaise, 125000);
  assert.ok(plan.budgetCeilingPaise <= 125000);
});
