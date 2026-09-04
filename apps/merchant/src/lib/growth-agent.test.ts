import assert from "node:assert/strict";
import test from "node:test";
import {
  createGrowthAgentRun,
  getGrowthAgentRun,
  resetGrowthAgentRunsForTests,
  runGrowthAgent,
  GROWTH_AGENT_TOOL_NAMES,
  type GrowthAgentPlanner,
} from "./growth-agent";
import { growthCampaigns } from "./campaigns";

process.env.GROWTH_AGENT_PERSISTENCE_DISABLED = "1";

test.afterEach(() => resetGrowthAgentRunsForTests());

function scriptedPlanner(tools: string[]): GrowthAgentPlanner {
  let index = 0;
  return async ({ availableTools }) => {
    const next = tools[index++] ?? tools.at(-1);
    assert.ok(next);
    assert.ok(availableTools.includes(next as (typeof availableTools)[number]));
    return {
      tool: next as (typeof GROWTH_AGENT_TOOL_NAMES)[number],
      arguments: {},
      callId: `call-${index}`,
      model: "test-planner",
      outputItems: [{ type: "function_call", name: next, call_id: `call-${index}`, arguments: "{}" }],
    };
  };
}

test("growth agent follows the model-selected tool sequence", async () => {
  const campaign = growthCampaigns[0];
  assert.ok(campaign);
  const run = createGrowthAgentRun({
    objective: "Increase basket value for headphone purchases",
    campaignId: campaign.id,
    maxSpendPaise: 800000,
  });

  const completed = await runGrowthAgent(run.id, {
    planner: scriptedPlanner(["list_opportunities", "get_campaign", "list_opportunities", "inspect_inventory", "prepare_offer"]),
  });

  assert.equal(completed.state, "COMPLETED");
  assert.equal(completed.stepCount, 5);
  assert.deepEqual(completed.trace.map((step) => step.tool), [
    "list_opportunities",
    "get_campaign",
    "list_opportunities",
    "inspect_inventory",
    "prepare_offer",
  ]);
  assert.ok(completed.preparedOffer);
  assert.equal(completed.plannerCalls, 5);
  assert.equal(completed.plannerModel, "test-planner");
  assert.ok(completed.trace.every((step) => step.plannerModel === "test-planner"));
  assert.equal(getGrowthAgentRun(run.id)?.state, "COMPLETED");
});

test("tool failures are returned to the planner for bounded recovery", async () => {
  const campaign = growthCampaigns[0];
  assert.ok(campaign);
  const run = createGrowthAgentRun({
    objective: "Recover from an out-of-order tool call",
    campaignId: campaign.id,
    maxSpendPaise: 800000,
  });

  const completed = await runGrowthAgent(run.id, {
    planner: scriptedPlanner(["prepare_offer", "list_opportunities", "inspect_inventory", "prepare_offer"]),
  });

  assert.equal(completed.state, "COMPLETED");
  assert.equal(completed.trace[0]?.status, "failed");
  assert.equal(completed.trace[0]?.error, "GROWTH_AGENT_OPPORTUNITY_NOT_SELECTED");
  assert.deepEqual(completed.trace.map((step) => step.tool), [
    "prepare_offer",
    "list_opportunities",
    "inspect_inventory",
    "prepare_offer",
  ]);
  assert.ok(completed.preparedOffer);
});

test("production tool registry contains no payment authority", () => {
  assert.ok(!GROWTH_AGENT_TOOL_NAMES.some((tool) => /razorpay|capture|payment|paid|order/i.test(tool)));
});

test("max steps remain a hard bound under model-directed planning", async () => {
  const campaign = growthCampaigns[0];
  assert.ok(campaign);
  const run = createGrowthAgentRun({
    objective: "bounded run",
    campaignId: campaign.id,
    maxSteps: 2,
  });

  const completed = await runGrowthAgent(run.id, {
    planner: scriptedPlanner(["get_campaign", "list_opportunities", "inspect_inventory"]),
  });

  assert.equal(completed.state, "FAILED");
  assert.equal(completed.stepCount, 2);
  assert.equal(completed.trace.length, 2);
  assert.equal(completed.lastPlannerError, undefined);
});

test("planner cannot introduce an unregistered tool", async () => {
  const campaign = growthCampaigns[0];
  assert.ok(campaign);
  const run = createGrowthAgentRun({ objective: "security boundary", campaignId: campaign.id });

  const completed = await runGrowthAgent(run.id, {
    planner: async () => ({
      tool: "create_razorpay_order" as never,
      arguments: {},
      callId: "malicious-call",
      model: "test-planner",
      outputItems: [],
    }),
  });

  assert.equal(completed.state, "FAILED");
  assert.equal(completed.stepCount, 0);
  assert.equal(completed.lastPlannerError, "GROWTH_AGENT_TOOL_NOT_ALLOWED");
  assert.equal(completed.preparedOffer, undefined);
});
