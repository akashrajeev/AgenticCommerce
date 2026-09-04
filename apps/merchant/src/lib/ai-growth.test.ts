import assert from "node:assert/strict";
import test from "node:test";
import { buildGrowthAiContext, validateGrowthAiPlan } from "./ai-growth";
import { growthCampaigns, getCampaignOpportunities } from "./campaigns";

test("growth AI context is grounded in merchant catalog and confirmed orders", () => {
  const context = buildGrowthAiContext([
    { amountPaise: 499900, incrementalRevenuePaise: 100000 },
    { amountPaise: 799900, incrementalRevenuePaise: 120000 },
  ]);
  assert.equal(context.testModeOnly, true);
  assert.equal(context.confirmedOrders, 2);
  assert.equal(context.confirmedRevenuePaise, 1299800);
  assert.equal(context.realizedIncrementalRevenuePaise, 220000);
  assert.equal(context.campaigns.length, growthCampaigns.length);
  assert.ok(context.catalog.length > 0);
  assert.ok(context.campaigns.some((campaign) => campaign.opportunities.length > 0));
});

test("rejects a plan that invents campaign or product identifiers", () => {
  const context = buildGrowthAiContext([]);
  assert.throws(
    () => validateGrowthAiPlan({
      campaignId: "invented-campaign",
      strategy: "CROSS_SELL",
      sourceProductId: "invented-source",
      targetProductId: "invented-target",
      audience: "buyers",
      rationale: "invented",
      evidence: [],
      guardrails: [],
      expectedIncrementalRevenuePaise: 1,
      confidence: 0.5,
    }, context),
    /AI_GROWTH_PLAN_OUTSIDE_ALLOWED_CATALOG/,
  );
});

test("accepts only an existing merchant opportunity and caps expected value", () => {
  const campaign = growthCampaigns.find((item) => getCampaignOpportunities(item).length > 0)!;
  const opportunity = getCampaignOpportunities(campaign)[0];
  const context = buildGrowthAiContext([]);
  const plan = validateGrowthAiPlan({
    campaignId: campaign.id,
    strategy: campaign.strategy,
    sourceProductId: opportunity.sourceProductId,
    targetProductId: opportunity.productId,
    audience: "buyers matching the source-product intent",
    rationale: "Use the existing merchant recommendation opportunity.",
    evidence: [{ metric: "catalog score", value: String(opportunity.score) }],
    guardrails: ["MANDATE authorization", "Razorpay Test Mode"],
    expectedIncrementalRevenuePaise: opportunity.incrementalRevenuePaise,
    confidence: 0.8,
  }, context);
  assert.equal(plan.campaignId, campaign.id);
  assert.equal(plan.targetProductId, opportunity.productId);
});

test("rejects expected incremental value above the merchant opportunity", () => {
  const campaign = growthCampaigns.find((item) => getCampaignOpportunities(item).length > 0)!;
  const opportunity = getCampaignOpportunities(campaign)[0];
  const context = buildGrowthAiContext([]);
  assert.throws(
    () => validateGrowthAiPlan({
      campaignId: campaign.id,
      strategy: campaign.strategy,
      sourceProductId: opportunity.sourceProductId,
      targetProductId: opportunity.productId,
      audience: "buyers",
      rationale: "existing opportunity",
      evidence: [],
      guardrails: [],
      expectedIncrementalRevenuePaise: opportunity.incrementalRevenuePaise + 1,
      confidence: 0.8,
    }, context),
    /AI_GROWTH_EXPECTED_VALUE_UNTRUSTED/,
  );
});
