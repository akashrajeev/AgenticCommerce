import { buildMultiLineQuote, findProduct, MERCHANT_ID } from "./catalog";
import { getCampaignOpportunities, getGrowthCampaign, type CampaignOpportunity } from "./campaigns";
import { persistGrowthAgentCheckpoint } from "./growth-agent-persistence";

export const GROWTH_AGENT_TOOL_NAMES = [
  "get_campaign",
  "list_opportunities",
  "inspect_inventory",
  "prepare_offer",
] as const;

export type GrowthAgentToolName = (typeof GROWTH_AGENT_TOOL_NAMES)[number];
export type GrowthAgentState = "CREATED" | "PLANNING" | "OBSERVING" | "EVALUATING" | "OFFER_READY" | "COMPLETED" | "FAILED";
export type GrowthAgentStepStatus = "started" | "succeeded" | "failed";
export type GrowthAgentPlanner = (input: {
  run: GrowthAgentRun;
  availableTools: readonly GrowthAgentToolName[];
  history: readonly unknown[];
}) => Promise<{ tool: GrowthAgentToolName; arguments: Record<string, unknown>; callId: string; model: string; outputItems: unknown[] }>;

export type GrowthAgentTraceStep = {
  step: number;
  state: GrowthAgentState;
  tool: GrowthAgentToolName;
  reason: string;
  status: GrowthAgentStepStatus;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  callId?: string;
  plannerModel?: string;
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
  plannerCalls: number;
  plannerModel?: string;
  lastPlannerError?: string;
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
const MAX_PLANNER_HISTORY_ITEMS = 32;
const runs = new Map<string, GrowthAgentRun>();
const plannerHistory = new Map<string, unknown[]>();

const TOOL_DESCRIPTIONS: Record<GrowthAgentToolName, string> = {
  get_campaign: "Read the selected merchant campaign, objective, strategy and source categories.",
  list_opportunities: "Inspect the current eligible merchant growth opportunities. This is observation only.",
  inspect_inventory: "Verify current source and target product inventory before preparing an offer.",
  prepare_offer: "Create a fresh merchant bundle quote from current catalog facts. This never authorizes or executes payment.",
};

export const GROWTH_AGENT_TOOLS = GROWTH_AGENT_TOOL_NAMES.map((name) => ({
  type: "function" as const,
  name,
  description: TOOL_DESCRIPTIONS[name],
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
}));

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
  planner?: { callId: string; model: string },
): GrowthAgentTraceStep {
  const step: GrowthAgentTraceStep = {
    step: run.trace.length + 1,
    state: run.state,
    tool,
    reason,
    status: "started",
    input,
    callId: planner?.callId,
    plannerModel: planner?.model,
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
  const selectedOpportunity = opportunities[0];
  if (!selectedOpportunity) throw new Error("GROWTH_AGENT_NO_ELIGIBLE_OPPORTUNITY");
  run.selectedOpportunity = selectedOpportunity;
  return {
    count: opportunities.length,
    opportunities: opportunities.slice(0, 12).map((opportunity) => ({
      campaignId: opportunity.campaignId,
      sourceProductId: opportunity.sourceProductId,
      targetProductId: opportunity.productId,
      type: opportunity.type,
      score: opportunity.score,
      incrementalRevenuePaise: opportunity.incrementalRevenuePaise,
      rationale: opportunity.rationale,
    })),
    selectedOpportunity: {
      campaignId: run.campaignId,
      sourceProductId: selectedOpportunity.sourceProductId,
      targetProductId: selectedOpportunity.productId,
      score: selectedOpportunity.score,
      incrementalRevenuePaise: selectedOpportunity.incrementalRevenuePaise,
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

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("GROWTH_AGENT_TOOL_ARGUMENTS_INVALID");
  if (Object.keys(value as Record<string, unknown>).length > 0) throw new Error("GROWTH_AGENT_TOOL_ARGUMENTS_UNSUPPORTED");
  return value as Record<string, unknown>;
}

function assertAllowedTool(name: string): asserts name is GrowthAgentToolName {
  if (!(GROWTH_AGENT_TOOL_NAMES as readonly string[]).includes(name)) throw new Error("GROWTH_AGENT_TOOL_NOT_ALLOWED");
}

function addModelOutputToHistory(runId: string, outputItems: unknown[], functionCallOutput: unknown): void {
  const history = plannerHistory.get(runId) ?? [];
  history.push(...outputItems, functionCallOutput);
  plannerHistory.set(runId, history.slice(-MAX_PLANNER_HISTORY_ITEMS));
}

function getPlannerHistory(runId: string): unknown[] {
  return [...(plannerHistory.get(runId) ?? [])];
}

function extractFunctionCalls(body: Record<string, unknown> | null): Array<{ name: string; arguments: string; callId: string; outputItem: unknown }> {
  const output = Array.isArray(body?.output) ? body.output : [];
  return output
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .filter((item) => item.type === "function_call")
    .map((item) => ({
      name: typeof item.name === "string" ? item.name : "",
      arguments: typeof item.arguments === "string" ? item.arguments : "{}",
      callId: typeof item.call_id === "string" ? item.call_id : "",
      outputItem: item,
    }));
}

function defaultGrowthAgentPlanner(): GrowthAgentPlanner {
  return async ({ run, availableTools, history }) => {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error("GROWTH_AGENT_AI_NOT_CONFIGURED");
    const model = (process.env.OPENAI_MODEL ?? "gpt-5.6").trim();
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        store: false,
        parallel_tool_calls: false,
        tool_choice: "auto",
        instructions: "You are the MANDATE merchant growth agent. Your job is to pursue the merchant objective by choosing exactly one allowed growth tool at a time. You must inspect before acting: get_campaign establishes the campaign, list_opportunities observes eligible commercial opportunities, inspect_inventory checks live availability, and prepare_offer creates a fresh quote. You may repeat observation tools when a prior result requires it. Never invent IDs, prices, inventory, payment state or revenue. Never call or request a payment tool. There is no payment authority in your tool set. An offer is only a proposal; payment authorization belongs to MANDATE. Prefer the minimum number of tool calls needed to reach OFFER_READY. If a tool reports an error, reconsider the next allowed tool rather than inventing a result. Call exactly one function tool and no prose when another tool is needed.",
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: JSON.stringify({ objective: run.objective, campaignId: run.campaignId, maxSpendPaise: run.maxSpendPaise, availableTools }) }],
          },
          ...history,
        ],
        tools: GROWTH_AGENT_TOOLS,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) throw new Error(`GROWTH_AGENT_AI_HTTP_${response.status}`);
    const calls = extractFunctionCalls(body);
    if (calls.length !== 1) throw new Error(calls.length === 0 ? "GROWTH_AGENT_NO_TOOL_CALL" : "GROWTH_AGENT_MULTIPLE_TOOL_CALLS");
    const call = calls.at(0);
    if (!call) throw new Error("GROWTH_AGENT_NO_TOOL_CALL");
    assertAllowedTool(call.name);
    let parsedArguments: unknown;
    try {
      parsedArguments = JSON.parse(call.arguments);
    } catch {
      throw new Error("GROWTH_AGENT_TOOL_ARGUMENTS_INVALID");
    }
    return {
      tool: call.name,
      arguments: parseToolArguments(parsedArguments),
      callId: call.callId,
      model,
      outputItems: Array.isArray(body?.output) ? body.output : [],
    };
  };
}

function toolReason(tool: GrowthAgentToolName): string {
  return TOOL_DESCRIPTIONS[tool];
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
    plannerCalls: 0,
    trace: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  runs.set(run.id, run);
  plannerHistory.set(run.id, []);
  return run;
}

async function checkpoint(run: GrowthAgentRun, step?: GrowthAgentTraceStep): Promise<boolean> {
  try {
    await persistGrowthAgentCheckpoint(run, step);
    return true;
  } catch (error) {
    run.lastPlannerError = error instanceof Error ? error.message : "GROWTH_AGENT_PERSISTENCE_FAILED";
    setState(run, "FAILED");
    return false;
  }
}

export async function runGrowthAgent(runId: string, options: { planner?: GrowthAgentPlanner } = {}): Promise<GrowthAgentRun> {
  const run = runs.get(runId);
  if (!run) throw new Error("GROWTH_AGENT_RUN_NOT_FOUND");
  if (["COMPLETED", "FAILED"].includes(run.state)) return run;

  const planner = options.planner ?? defaultGrowthAgentPlanner();
  if (!(await checkpoint(run))) return run;

  while (run.trace.length < run.maxSteps) {
    setState(run, "PLANNING");
    run.plannerCalls += 1;
    if (!(await checkpoint(run))) return run;

    let decision: Awaited<ReturnType<GrowthAgentPlanner>>;
    try {
      decision = await planner({
        run,
        availableTools: GROWTH_AGENT_TOOL_NAMES,
        history: getPlannerHistory(run.id),
      });
      assertAllowedTool(decision.tool);
      parseToolArguments(decision.arguments);
      run.plannerModel = decision.model;
      run.lastPlannerError = undefined;
    } catch (error) {
      run.lastPlannerError = error instanceof Error ? error.message : "GROWTH_AGENT_PLANNER_FAILED";
      setState(run, "FAILED");
      await checkpoint(run);
      return run;
    }

    setState(run, decision.tool === "get_campaign" || decision.tool === "list_opportunities" ? "OBSERVING" : "EVALUATING");
    const step = recordStep(run, decision.tool, toolReason(decision.tool), { campaignId: run.campaignId, maxSpendPaise: run.maxSpendPaise }, { callId: decision.callId, model: decision.model });
    let output: unknown;
    try {
      output = await executeTool(run, decision.tool);
      finishStep(run, step, output);
    } catch (error) {
      failStep(run, step, error);
      output = { error: step.error };
    }

    addModelOutputToHistory(run.id, decision.outputItems, {
      type: "function_call_output",
      call_id: decision.callId,
      output: JSON.stringify(output),
    });

    if (!(await checkpoint(run, step))) return run;

    if (decision.tool === "prepare_offer" && step.status === "succeeded") {
      setState(run, "OFFER_READY");
      setState(run, "COMPLETED");
      await checkpoint(run);
      return run;
    }
  }

  setState(run, "FAILED");
  const last = run.trace.at(-1);
  if (last && !last.error) last.error = "GROWTH_AGENT_MAX_STEPS_REACHED";
  await checkpoint(run, last);
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
  plannerHistory.clear();
}
