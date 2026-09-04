import type { BuyerAgentRun } from "./buyer-agent";
import {
  assertBuyerBudget,
  createBuyerAgentRun,
  failBuyerAgent,
  getBuyerAgentRun,
  recordBuyerAgentStep,
  transitionBuyerAgent,
} from "./buyer-agent";
import { buildBuyerAgentObservation } from "./buyer-agent-observation";
import {
  BUYER_AGENT_BASKET_OPTIMIZER_TOOL,
  BUYER_AGENT_BASKET_OPTIMIZER_TOOL_NAME,
  executeBuyerAgentBasketOptimizerTool,
} from "./buyer-agent-basket-optimizer";
import {
  BUYER_AGENT_OFFER_EVALUATION_TOOL,
  BUYER_AGENT_OFFER_EVALUATION_TOOL_NAME,
  executeBuyerAgentOfferEvaluationTool,
} from "./buyer-agent-offer-evaluation";
import {
  BUYER_AGENT_SELECTION_TOOL,
  BUYER_AGENT_SELECTION_TOOL_NAME,
  executeBuyerAgentSelectionTool,
} from "./buyer-agent-selection";
import { loadBuyerAgentRunClient, persistBuyerAgentCheckpointClient } from "./buyer-agent-persistence-client";
import {
  BUYER_AGENT_TOOLS,
  BUYER_AGENT_TOOL_NAMES,
  createBuyerAgentWorkspace,
  executeBuyerAgentTool,
  type BuyerAgentToolName,
  type BuyerAgentWorkspace,
} from "./buyer-agent-tools";

export type BuyerPlanningToolName = BuyerAgentToolName
  | typeof BUYER_AGENT_SELECTION_TOOL_NAME
  | typeof BUYER_AGENT_OFFER_EVALUATION_TOOL_NAME
  | typeof BUYER_AGENT_BASKET_OPTIMIZER_TOOL_NAME;

export type BuyerAgentPlanner = (input: {
  run: BuyerAgentRun;
  workspace: BuyerAgentWorkspace;
  availableTools: readonly BuyerPlanningToolName[];
  history: readonly unknown[];
}) => Promise<{
  tool: BuyerPlanningToolName;
  arguments: Record<string, unknown>;
  callId: string;
  model: string;
  outputItems: unknown[];
}>;

export type BuyerAgentTraceStep = {
  step: number;
  state: BuyerAgentRun["state"];
  tool: BuyerPlanningToolName;
  arguments: Record<string, unknown>;
  status: "started" | "succeeded" | "failed";
  reason?: string;
  output?: unknown;
  error?: string;
  callId?: string;
  plannerModel?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
};

export type BuyerAgentExecution = {
  run: BuyerAgentRun;
  workspace: BuyerAgentWorkspace;
  trace: BuyerAgentTraceStep[];
  plannerCalls: number;
  plannerModel?: string;
};

const DEFAULT_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-5.6";
const MAX_HISTORY_ITEMS = 32;
const histories = new Map<string, unknown[]>();
const traces = new Map<string, BuyerAgentTraceStep[]>();

const BASE_BUYER_AGENT_MODEL_TOOLS = BUYER_AGENT_TOOLS.map((tool) => {
  if (tool.name !== "search_products") return tool;
  return {
    ...tool,
    parameters: { ...tool.parameters, required: ["query", "category", "maxPricePaise", "inStockOnly"] },
  };
});

const BUYER_AGENT_MODEL_TOOLS = [
  ...BASE_BUYER_AGENT_MODEL_TOOLS,
  BUYER_AGENT_SELECTION_TOOL,
  BUYER_AGENT_OFFER_EVALUATION_TOOL,
  BUYER_AGENT_BASKET_OPTIMIZER_TOOL,
];

const ALL_BUYER_PLANNING_TOOLS = [
  ...BUYER_AGENT_TOOL_NAMES,
  BUYER_AGENT_SELECTION_TOOL_NAME,
  BUYER_AGENT_OFFER_EVALUATION_TOOL_NAME,
  BUYER_AGENT_BASKET_OPTIMIZER_TOOL_NAME,
] as const;

function now(): string {
  return new Date().toISOString();
}

function extractFunctionCall(body: Record<string, unknown> | null): { name: string; arguments: string; callId: string; outputItems: unknown[] } {
  const output = Array.isArray(body?.output) ? body.output : [];
  const calls = output
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .filter((item) => item.type === "function_call")
    .map((item) => ({
      name: typeof item.name === "string" ? item.name : "",
      arguments: typeof item.arguments === "string" ? item.arguments : "{}",
      callId: typeof item.call_id === "string" ? item.call_id : "",
    }));
  if (calls.length === 0) throw new Error("BUYER_AGENT_NO_TOOL_CALL");
  if (calls.length !== 1) throw new Error("BUYER_AGENT_MULTIPLE_TOOL_CALLS");
  const call = calls[0];
  if (!call) throw new Error("BUYER_AGENT_NO_TOOL_CALL");
  return { ...call, outputItems: output };
}

function assertAllowedTool(name: string): asserts name is BuyerPlanningToolName {
  if (!(ALL_BUYER_PLANNING_TOOLS as readonly string[]).includes(name)) throw new Error("BUYER_AGENT_TOOL_NOT_ALLOWED");
}

function parseArguments(value: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("BUYER_AGENT_TOOL_ARGUMENTS_INVALID"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("BUYER_AGENT_TOOL_ARGUMENTS_INVALID");
  return parsed as Record<string, unknown>;
}

function addHistory(runId: string, outputItems: unknown[], toolOutput: unknown): void {
  const history = histories.get(runId) ?? [];
  history.push(...outputItems, toolOutput);
  histories.set(runId, history.slice(-MAX_HISTORY_ITEMS));
}

function getHistory(runId: string): unknown[] {
  return [...(histories.get(runId) ?? [])];
}

function traceFor(runId: string): BuyerAgentTraceStep[] {
  const existing = traces.get(runId);
  if (existing) return existing;
  const created: BuyerAgentTraceStep[] = [];
  traces.set(runId, created);
  return created;
}

function describeTool(name: BuyerPlanningToolName): string {
  switch (name) {
    case "discover_merchant": return "Discover the merchant's machine-readable commerce contract.";
    case "read_catalog": return "Load the live machine-readable product catalog.";
    case "search_products": return "Narrow candidates against the buyer's immutable constraints.";
    case "inspect_product": return "Inspect a candidate before relying on it.";
    case "check_inventory": return "Verify current availability before basket construction.";
    case "get_quote": return "Refresh the current merchant price for the proposed basket.";
    case "compare_products": return "Compare observed candidates on normalized product facts.";
    case "select_product": return "Select one observed product using explicit buyer-facing reasoning and immutable constraints.";
    case "get_merchant_recommendations": return "Read merchant-published upsell/cross-sell options.";
    case "evaluate_merchant_offer": return "Explicitly accept or reject a merchant offer using buyer intent and constraints.";
    case "optimize_basket": return "Compare fresh-quoted basket options within the immutable buyer budget.";
    case "build_basket": return "Construct a buyer-proposed basket and obtain a fresh quote.";
    case "validate_budget": return "Deterministically verify the basket total against the hard limit.";
    case "prepare_approval": return "Freeze a review-ready proposal without authorizing payment.";
  }
}

async function persistCheckpoint(
  run: BuyerAgentRun,
  workspace: BuyerAgentWorkspace,
  plannerCalls: number,
  plannerModel: string | undefined,
  step: BuyerAgentTraceStep | undefined,
  enabled: boolean,
): Promise<void> {
  if (!enabled) return;
  await persistBuyerAgentCheckpointClient({ run, workspace, plannerCalls, plannerModel, step });
}

export function clearBuyerAgentExecutionForTests(): void {
  histories.clear();
  traces.clear();
}

export function getBuyerAgentTrace(runId: string): BuyerAgentTraceStep[] {
  return [...traceFor(runId)];
}

export function getBuyerAgentHistory(runId: string): unknown[] {
  return getHistory(runId);
}

export async function loadPersistedBuyerAgentRun(runId: string): Promise<unknown> {
  return loadBuyerAgentRunClient(runId);
}

export async function runBuyerAgent(options: {
  objective: string;
  maxSpendPaise: number;
  maxSteps?: number;
  requiredCategory?: string;
  requiredProductIds?: readonly string[];
  merchantInternalUrl?: string;
  planner?: BuyerAgentPlanner;
  persist?: boolean;
}): Promise<BuyerAgentExecution> {
  const run = createBuyerAgentRun(options);
  const workspace = createBuyerAgentWorkspace();
  const trace = traceFor(run.id);
  const planner = options.planner ?? defaultBuyerAgentPlanner;
  const persistenceEnabled = options.persist ?? true;
  let plannerCalls = 0;
  let plannerModel: string | undefined;

  transitionBuyerAgent(run.id, "PLANNING");

  try {
    await persistCheckpoint(run, workspace, plannerCalls, plannerModel, undefined, persistenceEnabled);
    while (run.state !== "WAITING_FOR_APPROVAL" && run.state !== "COMPLETED" && run.state !== "FAILED") {
      recordBuyerAgentStep(run.id);
      const stepNumber = run.stepCount;
      const startedAt = now();

      let plan: Awaited<ReturnType<BuyerAgentPlanner>>;
      try {
        plan = await planner({ run, workspace, availableTools: ALL_BUYER_PLANNING_TOOLS, history: getHistory(run.id) });
        plannerCalls += 1;
        plannerModel = plan.model;
        assertAllowedTool(plan.tool);
      } catch (error) {
        const message = error instanceof Error ? error.message : "BUYER_AGENT_PLANNER_FAILED";
        const failedStep: BuyerAgentTraceStep = { step: stepNumber, state: run.state, tool: "prepare_approval", arguments: {}, status: "failed", error: message, startedAt, completedAt: now() };
        trace.push(failedStep);
        failBuyerAgent(run.id, message);
        await persistCheckpoint(run, workspace, plannerCalls, plannerModel, failedStep, persistenceEnabled).catch(() => undefined);
        break;
      }

      const traceStep: BuyerAgentTraceStep = {
        step: stepNumber,
        state: run.state,
        tool: plan.tool,
        arguments: plan.arguments,
        status: "started",
        reason: describeTool(plan.tool),
        callId: plan.callId,
        plannerModel: plan.model,
        startedAt,
      };
      trace.push(traceStep);
      try {
        await persistCheckpoint(run, workspace, plannerCalls, plannerModel, traceStep, persistenceEnabled);
        const result = plan.tool === BUYER_AGENT_SELECTION_TOOL_NAME
          ? executeBuyerAgentSelectionTool({ run, workspace }, plan.arguments)
          : plan.tool === BUYER_AGENT_OFFER_EVALUATION_TOOL_NAME
            ? executeBuyerAgentOfferEvaluationTool({ run, workspace }, plan.arguments)
            : plan.tool === BUYER_AGENT_BASKET_OPTIMIZER_TOOL_NAME
              ? await executeBuyerAgentBasketOptimizerTool({ run, workspace, merchantInternalUrl: options.merchantInternalUrl }, plan.arguments)
              : await executeBuyerAgentTool({ run, workspace, merchantInternalUrl: options.merchantInternalUrl }, plan.tool, plan.arguments);

        traceStep.status = "succeeded";
        traceStep.output = result.result;
        traceStep.completedAt = now();
        traceStep.durationMs = Math.max(Date.parse(traceStep.completedAt) - Date.parse(startedAt), 0);
        addHistory(run.id, plan.outputItems, { type: "function_call_output", call_id: plan.callId, output: JSON.stringify(result.result) });

        if (plan.tool === "discover_merchant" || plan.tool === "read_catalog") transitionIfPossible(run, "OBSERVING");
        else if (plan.tool === "search_products") transitionIfPossible(run, "SEARCHING");
        else if (plan.tool === "compare_products") transitionIfPossible(run, "COMPARING");
        else if (plan.tool === BUYER_AGENT_SELECTION_TOOL_NAME || plan.tool === BUYER_AGENT_BASKET_OPTIMIZER_TOOL_NAME || plan.tool === "build_basket") transitionIfPossible(run, "BUILDING_BASKET");
        else if (plan.tool === "prepare_approval") {
          assertBuyerBudget(run, workspace.latestQuote?.totalPaise ?? -1);
          transitionIfPossible(run, "WAITING_FOR_APPROVAL");
          await persistCheckpoint(run, workspace, plannerCalls, plannerModel, traceStep, persistenceEnabled);
          break;
        }
        await persistCheckpoint(run, workspace, plannerCalls, plannerModel, traceStep, persistenceEnabled);
      } catch (error) {
        traceStep.status = "failed";
        traceStep.error = error instanceof Error ? error.message : "BUYER_AGENT_TOOL_FAILED";
        traceStep.completedAt = now();
        traceStep.durationMs = Math.max(Date.parse(traceStep.completedAt) - Date.parse(startedAt), 0);
        addHistory(run.id, plan.outputItems, { type: "function_call_output", call_id: plan.callId, output: JSON.stringify({ error: traceStep.error }) });
        await persistCheckpoint(run, workspace, plannerCalls, plannerModel, traceStep, persistenceEnabled).catch(() => undefined);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "BUYER_AGENT_FAILED";
    failBuyerAgent(run.id, message);
    await persistCheckpoint(run, workspace, plannerCalls, plannerModel, undefined, persistenceEnabled).catch(() => undefined);
  }

  return { run, workspace, trace: [...trace], plannerCalls, plannerModel };
}

function transitionIfPossible(run: BuyerAgentRun, state: BuyerAgentRun["state"]): void {
  if (run.state === state) return;
  try { transitionBuyerAgent(run.id, state); }
  catch { if (state !== "PLANNING") throw new Error(`BUYER_AGENT_INVALID_TRANSITION:${run.state}->${state}`); }
}

async function defaultBuyerAgentPlanner(input: Parameters<BuyerAgentPlanner>[0]): Promise<Awaited<ReturnType<BuyerAgentPlanner>>> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("BUYER_AGENT_AI_NOT_CONFIGURED");
  const observation = buildBuyerAgentObservation(input.run, input.workspace);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      store: false,
      parallel_tool_calls: false,
      tool_choice: "auto",
      instructions: [
        "You are the buyer agent inside MANDATE.",
        "Achieve the user's shopping objective using only the bounded buyer tools.",
        "Choose exactly one tool per turn.",
        "Discover and observe before deciding whenever the needed facts are not yet known.",
        "Use compare_products when multiple observed candidates need explicit comparison.",
        "Use select_product to make an explicit candidate choice after comparing observed facts. Supply a concise user-facing reason.",
        "Verify inventory before relying on a selected product.",
        "Read merchant recommendations and explicitly evaluate relevant offers; do not blindly maximize spend.",
        "Use optimize_basket to compare the base product with useful observed additions using fresh quotes.",
        "Use fresh quotes before finalizing a basket.",
        "If a tool fails or a candidate becomes unavailable, replan from observed facts.",
        "The hard spending limit is application-owned and immutable.",
        "Never authorize, create, capture, refund or claim a payment occurred.",
        "prepare_approval only creates a review-ready proposal and still requires explicit user approval.",
        "Return concise decision reasons, not hidden chain-of-thought.",
      ].join(" "),
      input: [
        { role: "user", content: [{ type: "input_text", text: JSON.stringify(observation) }] },
        ...input.history,
      ],
      tools: BUYER_AGENT_MODEL_TOOLS,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(`BUYER_AGENT_AI_HTTP_${response.status}`);
  const call = extractFunctionCall(body);
  assertAllowedTool(call.name);
  return { tool: call.name, arguments: parseArguments(call.arguments), callId: call.callId, model: DEFAULT_MODEL, outputItems: call.outputItems };
}
