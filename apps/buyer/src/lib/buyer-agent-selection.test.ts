import assert from "node:assert/strict";
import test from "node:test";
import { createBuyerAgentRun, resetBuyerAgentRunsForTests } from "./buyer-agent";
import { createBuyerAgentWorkspace } from "./buyer-agent-tools";
import { executeBuyerAgentSelectionTool } from "./buyer-agent-selection";

test.afterEach(() => resetBuyerAgentRunsForTests());

function context() {
  const run = createBuyerAgentRun({ objective: "Find travel headphones", maxSpendPaise: 700000, requiredCategory: "headphones" });
  const workspace = createBuyerAgentWorkspace();
  workspace.catalog = [{
    id: "hp-001",
    name: "SoundMax Pro",
    category: "headphones",
    pricePaise: 619900,
    rating: 4.8,
    inventory: 4,
    features: ["ANC"],
    specifications: {},
  }];
  return { run, workspace };
}

test("selects an observed product with an explicit buyer reason", () => {
  const ctx = context();
  const result = executeBuyerAgentSelectionTool(ctx, {
    productId: "hp-001",
    reason: "Highest observed fit for the travel requirement within budget.",
  });
  assert.equal(ctx.workspace.selectedProductId, "hp-001");
  assert.equal((result.result as { status: string }).status, "SELECTED");
  assert.match((result.result as { reason: string }).reason, /Highest observed/);
});

test("rejects a product that was not observed", () => {
  const ctx = context();
  assert.throws(
    () => executeBuyerAgentSelectionTool(ctx, { productId: "hp-999", reason: "Looks good" }),
    /BUYER_AGENT_SELECTION_PRODUCT_NOT_OBSERVED/,
  );
});

test("rejects selection outside the buyer's required category", () => {
  const ctx = context();
  ctx.workspace.catalog = [{ ...ctx.workspace.catalog![0]!, id: "mouse-001", name: "Mouse", category: "mice" }];
  assert.throws(
    () => executeBuyerAgentSelectionTool(ctx, { productId: "mouse-001", reason: "Looks useful" }),
    /BUYER_AGENT_SELECTED_PRODUCT_CATEGORY_MISMATCH/,
  );
});
