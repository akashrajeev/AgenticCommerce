import assert from "node:assert/strict";
import test from "node:test";
import {
  createGrowthAgentRun,
  getGrowthAgentRun,
  resetGrowthAgentRunsForTests,
  runGrowthAgent,
  GROWTH_AGENT_TOOL_NAMES,
} from "./growth-agent";
import { growthCampaigns } from "./campaigns";

test.afterEach(() => resetGrowthAgentRunsForTests());

test("growth agent orchestrates bounded observation into a fresh offer", async () => {
  const campaign = growthCampaigns[0];
  assert.ok(campaign);
  const run = createGrowthAgentRun({
    objective: "Increase basket value for headphone purchases",
    campaignId: campaign.id,
    maxSpendPaise: 800000,
  });

  const completed = await runGrowthAgent(run.id);

  assert.equal(completed.state, "COMPLETED");
  assert.equal(completed.stepCount, 4);
  assert.deepEqual(completed.trace.map((step) => step.tool), [
    "get_campaign",
    "list_opportunities",
    "inspect_inventory",
    "prepare_offer",
  ]);
  assert.ok(completed.preparedOffer);
  assert.equal(completed.preparedOffer?.merchantId, campaign.merchantId);
  assert.ok((completed.preparedOffer?.bundleAmountPaise ?? 0) <= 800000);
  assert.equal(getGrowthAgentRun(run.id)?.state, "COMPLETED");
});

test("growth agent fails closed when the configured budget excludes every opportunity", async () => {
  const campaign = growthCampaigns[0];
  assert.ok(campaign);
  const run = createGrowthAgentRun({
    objective: "Find an eligible bundle",
    campaignId: campaign.id,
    maxSpendPaise: 1,
  });

  const completed = await runGrowthAgent(run.id);

  assert.equal(completed.state, "FAILED");
  assert.equal(completed.trace.at(-1)?.tool, "list_opportunities");
  assert.equal(completed.trace.at(-1)?.error, "GROWTH_AGENT_NO_ELIGIBLE_OPPORTUNITY");
  assert.equal(completed.preparedOffer, undefined);
});

test("agent tool surface contains no payment authority", () => {
  assert.ok(!GROWTH_AGENT_TOOL_NAMES.some((tool) => /razorpay|capture|payment|paid|order/i.test(tool)));
});

test("max steps are hard bounded", async () => {
  const campaign = growthCampaigns[0];
  assert.ok(campaign);
  const run = createGrowthAgentRun({
    objective: "bounded run",
    campaignId: campaign.id,
    maxSteps: 1,
  });

  const completed = await runGrowthAgent(run.id);

  assert.equal(completed.state, "FAILED");
  assert.equal(completed.stepCount, 1);
  assert.equal(completed.trace.length, 1);
  assert.equal(completed.trace[0]?.tool, "get_campaign");
});
