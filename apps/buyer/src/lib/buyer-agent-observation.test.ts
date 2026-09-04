import assert from "node:assert/strict";
import test from "node:test";
import { createBuyerAgentRun, resetBuyerAgentRunsForTests } from "./buyer-agent";
import { createBuyerAgentWorkspace } from "./buyer-agent-tools";
import { buildBuyerAgentObservation } from "./buyer-agent-observation";

test.afterEach(() => resetBuyerAgentRunsForTests());

test("builds a bounded planner observation from merchant facts and buyer constraints", () => {
  const run = createBuyerAgentRun({
    objective: "Find ANC headphones under ₹7,000",
    maxSpendPaise: 700000,
    requiredCategory: "headphones",
  });
  const workspace = createBuyerAgentWorkspace();
  workspace.manifest = { merchantId: "mandate-market", name: "Mandate Market", version: "1.3", currency: "INR", capabilities: {}, endpoints: {} };
  workspace.catalog = Array.from({ length: 25 }, (_, index) => ({
    id: `product-${index}`,
    name: `Product ${index}`,
    category: "headphones",
    pricePaise: 100000 + index,
    rating: 4.5,
    inventory: 10,
    features: ["ANC", "Battery"],
    specifications: { battery: "40h" },
  }));
  workspace.selectedProductId = "product-0";
  workspace.inventory["product-0"] = 10;
  workspace.recommendations = [{ productId: "case-001", type: "CROSS_SELL", score: 0.9, rationale: "Useful for travel", incrementalRevenuePaise: 49900 }];
  workspace.basket = [{ productId: "product-0", quantity: 1 }];
  workspace.latestQuote = {
    quoteId: "quote-1",
    merchantId: "mandate-market",
    lineItems: [{ productId: "product-0", quantity: 1, unitPricePaise: 100000, lineTotalPaise: 100000 }],
    subtotalPaise: 100000,
    shippingPaise: 0,
    taxPaise: 0,
    discountPaise: 0,
    totalPaise: 100000,
    currency: "INR",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };

  const observation = buildBuyerAgentObservation(run, workspace);
  assert.equal(observation.catalog.count, 25);
  assert.equal(observation.catalog.products.length, 20);
  assert.equal(observation.constraints.maxSpendPaise, 700000);
  assert.equal(observation.merchant.merchantId, "mandate-market");
  assert.equal(observation.selectedProductId, "product-0");
  assert.equal(observation.latestQuote?.quoteId, "quote-1");
  assert.equal("razorpayOrderId" in observation, false);
  assert.equal("paymentId" in observation, false);
  assert.equal("authorizationId" in observation, false);
});
