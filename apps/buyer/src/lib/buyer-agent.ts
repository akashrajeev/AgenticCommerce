export const BUYER_AGENT_STATES = [
  "CREATED",
  "PLANNING",
  "OBSERVING",
  "SEARCHING",
  "COMPARING",
  "BUILDING_BASKET",
  "WAITING_FOR_APPROVAL",
  "COMPLETED",
  "FAILED",
] as const;

export type BuyerAgentState = (typeof BUYER_AGENT_STATES)[number];

export type BuyerAgentConstraints = Readonly<{
  maxSpendPaise: number;
  currency: "INR";
  maxSteps: number;
  requiredCategory?: string;
  requiredProductIds?: readonly string[];
}>;

export type BuyerAgentRun = {
  readonly id: string;
  readonly objective: string;
  readonly constraints: BuyerAgentConstraints;
  state: BuyerAgentState;
  stepCount: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

const DEFAULT_MAX_STEPS = 12;
const MAX_STEPS = 20;
const runs = new Map<string, BuyerAgentRun>();

const ALLOWED_TRANSITIONS: Record<BuyerAgentState, readonly BuyerAgentState[]> = {
  CREATED: ["PLANNING", "FAILED"],
  PLANNING: ["OBSERVING", "SEARCHING", "COMPARING", "BUILDING_BASKET", "WAITING_FOR_APPROVAL", "FAILED"],
  OBSERVING: ["PLANNING", "SEARCHING", "COMPARING", "BUILDING_BASKET", "WAITING_FOR_APPROVAL", "FAILED"],
  SEARCHING: ["PLANNING", "OBSERVING", "COMPARING", "BUILDING_BASKET", "FAILED"],
  COMPARING: ["PLANNING", "OBSERVING", "SEARCHING", "BUILDING_BASKET", "FAILED"],
  BUILDING_BASKET: ["PLANNING", "COMPARING", "WAITING_FOR_APPROVAL", "FAILED"],
  WAITING_FOR_APPROVAL: ["COMPLETED", "PLANNING", "FAILED"],
  COMPLETED: [],
  FAILED: [],
};

function now(): string {
  return new Date().toISOString();
}

function createRunId(): string {
  return `bar_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function freezeArray(values: readonly string[] | undefined): readonly string[] | undefined {
  if (!values) return undefined;
  return Object.freeze([...values]);
}

function freezeConstraints(input: {
  maxSpendPaise: number;
  currency?: "INR";
  maxSteps: number;
  requiredCategory?: string;
  requiredProductIds?: readonly string[];
}): BuyerAgentConstraints {
  const constraints: BuyerAgentConstraints = {
    maxSpendPaise: input.maxSpendPaise,
    currency: "INR",
    maxSteps: input.maxSteps,
    ...(input.requiredCategory ? { requiredCategory: input.requiredCategory.trim().slice(0, 100) } : {}),
    ...(input.requiredProductIds?.length ? { requiredProductIds: freezeArray(input.requiredProductIds) } : {}),
  };
  return Object.freeze(constraints);
}

function validateObjective(objective: string): string {
  const value = objective.trim().slice(0, 500);
  if (!value) throw new Error("BUYER_AGENT_OBJECTIVE_REQUIRED");
  return value;
}

function validateConstraints(input: {
  maxSpendPaise: number;
  maxSteps?: number;
  requiredCategory?: string;
  requiredProductIds?: readonly string[];
}): BuyerAgentConstraints {
  if (!Number.isSafeInteger(input.maxSpendPaise) || input.maxSpendPaise < 0) {
    throw new Error("BUYER_AGENT_MAX_SPEND_INVALID");
  }

  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > MAX_STEPS) {
    throw new Error("BUYER_AGENT_MAX_STEPS_INVALID");
  }

  const requiredProductIds = input.requiredProductIds?.map((id) => id.trim()).filter(Boolean);
  if (requiredProductIds && new Set(requiredProductIds).size !== requiredProductIds.length) {
    throw new Error("BUYER_AGENT_REQUIRED_PRODUCT_IDS_DUPLICATE");
  }

  return freezeConstraints({
    maxSpendPaise: input.maxSpendPaise,
    currency: "INR",
    maxSteps,
    requiredCategory: input.requiredCategory,
    requiredProductIds,
  });
}

function touch(run: BuyerAgentRun): void {
  run.updatedAt = now();
}

export function createBuyerAgentRun(input: {
  objective: string;
  maxSpendPaise: number;
  maxSteps?: number;
  requiredCategory?: string;
  requiredProductIds?: readonly string[];
}): BuyerAgentRun {
  const constraints = validateConstraints(input);
  const timestamp = now();
  const run: BuyerAgentRun = {
    id: createRunId(),
    objective: validateObjective(input.objective),
    constraints,
    state: "CREATED",
    stepCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  runs.set(run.id, run);
  return run;
}

export function getBuyerAgentRun(runId: string): BuyerAgentRun | undefined {
  return runs.get(runId);
}

export function transitionBuyerAgent(runId: string, nextState: BuyerAgentState): BuyerAgentRun {
  const run = runs.get(runId);
  if (!run) throw new Error("BUYER_AGENT_RUN_NOT_FOUND");
  if (!ALLOWED_TRANSITIONS[run.state].includes(nextState)) {
    throw new Error(`BUYER_AGENT_INVALID_TRANSITION:${run.state}->${nextState}`);
  }
  run.state = nextState;
  touch(run);
  if (nextState === "COMPLETED" || nextState === "FAILED") run.completedAt = run.updatedAt;
  if (nextState !== "FAILED") delete run.lastError;
  return run;
}

export function recordBuyerAgentStep(runId: string): BuyerAgentRun {
  const run = runs.get(runId);
  if (!run) throw new Error("BUYER_AGENT_RUN_NOT_FOUND");
  if (run.state === "COMPLETED" || run.state === "FAILED") {
    throw new Error("BUYER_AGENT_RUN_TERMINAL");
  }
  if (run.stepCount >= run.constraints.maxSteps) {
    run.lastError = "BUYER_AGENT_MAX_STEPS_EXCEEDED";
    run.state = "FAILED";
    touch(run);
    run.completedAt = run.updatedAt;
    throw new Error("BUYER_AGENT_MAX_STEPS_EXCEEDED");
  }
  run.stepCount += 1;
  touch(run);
  return run;
}

export function failBuyerAgent(runId: string, error: string): BuyerAgentRun {
  const run = runs.get(runId);
  if (!run) throw new Error("BUYER_AGENT_RUN_NOT_FOUND");
  if (run.state !== "FAILED" && run.state !== "COMPLETED") {
    run.state = "FAILED";
    run.lastError = error.trim().slice(0, 300) || "BUYER_AGENT_FAILED";
    touch(run);
    run.completedAt = run.updatedAt;
  }
  return run;
}

export function assertBuyerBudget(run: BuyerAgentRun, totalPaise: number): void {
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 0) throw new Error("BUYER_AGENT_TOTAL_INVALID");
  if (totalPaise > run.constraints.maxSpendPaise) throw new Error("BUYER_AGENT_BUDGET_EXCEEDED");
}

export function resetBuyerAgentRunsForTests(): void {
  runs.clear();
}

export function getBuyerAgentStateTransitions(): Readonly<Record<BuyerAgentState, readonly BuyerAgentState[]>> {
  return ALLOWED_TRANSITIONS;
}
