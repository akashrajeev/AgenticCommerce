import { buildMultiLineQuote, findProduct, MERCHANT_ID } from "./catalog";
import { getCampaignOpportunities, getGrowthCampaign, type CampaignOpportunity } from "./campaigns";

export const GROWTH_AGENT_TOOL_NAMES = [
  "get_campaign",
  "list_opportunities",
  "inspect_inventory",
  "prepare_offer",
] as const;

export type GrowthAgentToolName = (typeof GROWTH_AGENT_TOOL_NAMES)[number];
export type GrowthAgentState = "CREATED" | "OBSERVING" | "EVALUATING" | "OFFER_READY" | "COMPLETED" | "FAILED";
export type GrowthAgentStepStatus = "started" | "succeeded" | "failed";

export type GrowthAgentTraceStep = {
  step: number;
  state: GrowthAgentState;
  tool: GrowthAgentToolName;
  reason: string;
  status: GrowthAgentStepStatus;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
};

export type GrowthAgentRun = {
  id: string;
  objective: string;
  campaignId: string;
  maxSpendPaise: number | null;
  maxSteps: number;
  state: GrowthAgentState;
  stepCount: number;
  selectedOpportunity?: CampaignOpportunity;
  preparedOffer?: {
    merchantId: string;
    sourceProductId: string;
    targetProductId: string;
    lineItems: Array<{ productId: string; quantity: number }>;
    sourceAmountPaise: number;
    bundleAmountPaise: number;
    incrementalRevenuePaise: number;
    quoteId: string;
    expiresAt: string;
  };
  trace: GrowthAgentTraceStep[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

const DEFAULT_MAX_STEPS = 8;
const runs = new Map<string, GrowthAgentRun>();

function now(): string {
  return new Date().toISOString();
}

function createRunId(): string {
  return `gar_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function setState(run: GrowthAgentRun, state: GrowthAgentState): void {
  run.state = state;
  run.updatedAt = now();
  if (["COMPLETED", "FAILED"].includes(state)) run.completedAt = run.updatedAt;
}

function recordStep(
  run: GrowthAgentRun,
  tool: GrowthAgentToolName,
  reason: string,
  input: Record<string, unknown>,
): GrowthAgentTraceStep {
  const step: GrowthAgentTraceStep = {
    step: run.trace.length + 1,
    state: run.state,
    tool,
    reason,
    status: "started",
    input,
    startedAt: now(),
  };
  run.trace.push(step);
  run.stepCount = run.trace.length;
  run.updatedAt = step.startedAt;
  return step;
}

function finishStep(run: GrowthAgentRun, step: GrowthAgentTraceStep, output: unknown): void {
  step.status = "succeeded";
  step.output = output;
  step.completedAt = now();
  step.durationMs = Math.max(Date.parse(step.completedAt) - Date.parse(step.startedAt), 0);
  run.updatedAt = step.completedAt;
}

function failStep(run: GrowthAgentRun, step: GrowthAgentTraceStep, error: unknown): void {
  step.status = "failed";
  step.error = error instanceof Error ? error.message : "GROWTH_AGENT_TOOL_FAILED";
  step.completedAt = now();
  step.durationMs = Math.max(Date.parse(step.completedAt) - Date.parse(step.startedAt), 0);
  run.updatedAt = step.completedAt;
}

function getSelectedOpportunity(run: GrowthAgentRun): CampaignOpportunity {
  if (!run.selectedOpportunity) throw new Error("GROWTH_AGENT_OPPORTUNITY_NOT_SELECTED");
  return run.selectedOpportunity;
}

function getCampaignTool(run: GrowthAgentRun): unknown {
  const campaign = getGrowthCampaign(run.campaignId);
  if (!campaign) throw new Error("GROWTH_AGENT_CAMPAIGN_NOT_FOUND");
  return {
    id: campaign.id,
    merchantId: campaign.merchantId,
    name: campaign.name,
    objective: campaign.objective,
    strategy: campaign.strategy,
    sourceCategories: campaign.sourceCategories,
    testModeOnly: true,
  };
}

function listOpportunitiesTool(run: GrowthAgentRun): unknown {
  const campaign = getGrowthCampaign(run.campaignId);
  if (!campaign) throw new Error("GROWTH_AGENT_CAMPAIGN_NOT_FOUND");
  const opportunities = getCampaignOpportunities(campaign).filter((opportunity) => {
    if (run.maxSpendPaise === null) return true;
    const source = findProduct(opportunity.sourceProductId);
    const target = findProduct(opportunity.productId);
    if (!source || !target) return false;
    return source.pricePaise + target.pricePaise <= run.maxSpendPaise;
  });
  if (!opportunities.length) throw new Error("GROWTH_AGENT_NO_ELIGIBLE_OPPORTUNITY");
  run.selectedOpportunity = opportunities[0];
  return {
    count: opportunities.length,
    selectedOpportunity: {
      campaignId: run.campaignId,
      sourceProductId: opportunities[0].sourceProductId,
      targetProductId: opportunities[0].productId,
      score: opportunities[0].score,
      incrementalRevenuePaise: opportunities[0].incrementalRevenuePaise,
    },
  };
}

function inspectInventoryTool(run: GrowthAgentRun): unknown {
  const opportunity = getSelectedOpportunity(run);
  const source = findProduct(opportunity.sourceProductId);
  const target = findProduct(opportunity.productId);
  if (!source || !target) throw new Error("GROWTH_AGENT_PRODUCT_NOT_FOUND");
  if (source.inventory <= 0) throw new Error("GROWTH_AGENT_SOURCE_OUT_OF_STOCK");
  if (target.inventory <= 0) throw new Error("GROWTH_AGENT_TARGET_OUT_OF_STOCK");
  return {
    source: { productId: source.id, inventory: source.inventory },
    target: { productId: target.id, inventory: target.inventory },
  };
}

function prepareOfferTool(run: GrowthAgentRun): unknown {
  const opportunity = getSelectedOpportunity(run);
  const source = findProduct(opportunity.sourceProductId);
  const target = findProduct(opportunity.productId);
  if (!source || !target) throw new Error("GROWTH_AGENT_PRODUCT_NOT_FOUND");
  const sourceQuote = buildMultiLineQuote([{ productId: source.id, quantity: 1 }]);
  const bundleQuote = buildMultiLineQuote(
    opportunity.type === "UPSELL"
      ? [{ productId: target.id, quantity: 1 }]
      : [{ productId: source.id, quantity: 1 }, { productId: target.id, quantity: 1 }],
  );
  if (run.maxSpendPaise !== null && bundleQuote.totalPaise > run.maxSpendPaise) {
    throw new Error("GROWTH_AGENT_BUNDLE_OVER_BUDGET");
  }
  run.preparedOffer = {
    merchantId: MERCHANT_ID,
    sourceProductId: source.id,
    targetProductId: target.id,
    lineItems: opportunity.type === "UPSELL"
      ? [{ productId: target.id, quantity: 1 }]
      : [{ productId: source.id, quantity: 1 }, { productId: target.id, quantity: 1 }],
    sourceAmountPaise: sourceQuote.totalPaise,
    bundleAmountPaise: bundleQuote.totalPaise,
    incrementalRevenuePaise: Math.max(bundleQuote.subtotalPaise - sourceQuote.subtotalPaise, 0),
    quoteId: bundleQuote.quoteId,
    expiresAt: bundleQuote.expiresAt,
  };
  return run.preparedOffer;
}

function executeTool(run: GrowthAgentRun, tool: GrowthAgentToolName): unknown {
  switch (tool) {
    case "get_campaign":
      return getCampaignTool(run);
    case "list_opportunities":
      return listOpportunitiesTool(run);
    case "inspect_inventory":
      return inspectInventoryTool(run);
    case "prepare_offer":
      return prepareOfferTool(run);
  }
}

function nextTool(run: GrowthAgentRun): { tool: GrowthAgentToolName; reason: string } | null {
  switch (run.trace.at(-1)?.tool) {
    case undefined:
      return { tool: "get_campaign", reason: "Establish the merchant campaign objective and hard constraints before selecting an opportunity." };
    case "get_campaign":
      return { tool: "list_opportunities", reason: "Observe the live merchant opportunity set before making a growth decision." };
    case "list_opportunities":
      return { tool: "inspect_inventory", reason: "Validate current availability before preparing a buyer-facing commercial offer." };
    case "inspect_inventory":
      return { tool: "prepare_offer", reason: "Construct a fresh merchant quote from current catalog facts; no client amount is trusted." };
    case "prepare_offer":
      return null;
  }
}

export function createGrowthAgentRun(input: { objective: string; campaignId: string; maxSpendPaise?: number; maxSteps?: number }): GrowthAgentRun {
  const objective = input.objective.trim().slice(0, 500);
  if (!objective) throw new Error("GROWTH_AGENT_OBJECTIVE_REQUIRED");
  const campaign = getGrowthCampaign(input.campaignId);
  if (!campaign) throw new Error("GROWTH_AGENT_CAMPAIGN_NOT_FOUND");
  const maxSpendPaise = input.maxSpendPaise === undefined ? null : input.maxSpendPaise;
  if (maxSpendPaise !== null && (!Number.isSafeInteger(maxSpendPaise) || maxSpendPaise < 0)) throw new Error("GROWTH_AGENT_MAX_SPEND_INVALID");
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 20) throw new Error("GROWTH_AGENT_MAX_STEPS_INVALID");
  const timestamp = now();
  const run: GrowthAgentRun = {
    id: createRunId(),
    objective,
    campaignId: campaign.id,
    maxSpendPaise,
    maxSteps,
    state: "CREATED",
    stepCount: 0,
    trace: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  runs.set(run.id, run);
  return run;
}

export async function runGrowthAgent(runId: string): Promise<GrowthAgentRun> {
  const run = runs.get(runId);
  if (!run) throw new Error("GROWTH_AGENT_RUN_NOT_FOUND");
  if (["COMPLETED", "FAILED"].includes(run.state)) return run;

  while (run.trace.length < run.maxSteps) {
    const next = nextTool(run);
    if (!next) {
      setState(run, "COMPLETED");
      return run;
    }

    setState(run, next.tool === "get_campaign" || next.tool === "list_opportunities" ? "OBSERVING" : "EVALUATING");
    const step = recordStep(run, next.tool, next.reason, { campaignId: run.campaignId, maxSpendPaise: run.maxSpendPaise });
    try {
      const output = await executeTool(run, next.tool);
      if (next.tool === "prepare_offer") setState(run, "OFFER_READY");
      finishStep(run, step, output);
      if (next.tool === "prepare_offer") {
        setState(run, "COMPLETED");
        return run;
      }
    } catch (error) {
      failStep(run, step, error);
      setState(run, "FAILED");
      return run;
    }
  }

  setState(run, "FAILED");
  const last = run.trace.at(-1);
  if (last) last.error = "GROWTH_AGENT_MAX_STEPS_REACHED";
  return run;
}

export function getGrowthAgentRun(runId: string): GrowthAgentRun | undefined {
  return runs.get(runId);
}

export function listGrowthAgentRuns(): GrowthAgentRun[] {
  return [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function resetGrowthAgentRunsForTests(): void {
  runs.clear();
}
