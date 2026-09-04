import type { Application, Request, Response } from "express";
import { config } from "./config.js";
import {
  loadGrowthAgentRun,
  listGrowthAgentRuns,
  saveGrowthAgentCheckpoint,
  type PersistedGrowthAgentRun,
  type PersistedGrowthAgentTraceStep,
} from "./persistence-prisma.js";

function internalSecretOrThrow(request: Request): void {
  const provided = request.header("x-mandate-gateway-secret") ?? "";
  if (!provided || provided !== config.internalGatewaySecret) throw new Error("UNAUTHORIZED_GROWTH_AGENT_PERSISTENCE");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_GROWTH_AGENT_RUN");
  return value as Record<string, unknown>;
}

function parseRun(value: unknown): PersistedGrowthAgentRun {
  const input = asRecord(value);
  const trace = input.trace;
  if (typeof input.id !== "string" || !input.id || typeof input.objective !== "string" || typeof input.campaignId !== "string" || typeof input.maxSteps !== "number" || !Number.isInteger(input.maxSteps) || typeof input.stepCount !== "number" || !Number.isInteger(input.stepCount) || typeof input.plannerCalls !== "number" || !Number.isInteger(input.plannerCalls) || typeof input.state !== "string" || !Array.isArray(trace) || typeof input.createdAt !== "string" || typeof input.updatedAt !== "string") {
    throw new Error("INVALID_GROWTH_AGENT_RUN");
  }
  const maxSpendPaise = input.maxSpendPaise === null || input.maxSpendPaise === undefined ? null : input.maxSpendPaise;
  if (maxSpendPaise !== null && (typeof maxSpendPaise !== "number" || !Number.isSafeInteger(maxSpendPaise) || maxSpendPaise < 0)) throw new Error("INVALID_GROWTH_AGENT_RUN");
  return {
    id: input.id,
    objective: input.objective,
    campaignId: input.campaignId,
    maxSpendPaise,
    maxSteps: input.maxSteps,
    state: input.state,
    stepCount: input.stepCount,
    plannerCalls: input.plannerCalls,
    plannerModel: typeof input.plannerModel === "string" ? input.plannerModel : undefined,
    lastPlannerError: typeof input.lastPlannerError === "string" ? input.lastPlannerError : undefined,
    selectedOpportunity: input.selectedOpportunity,
    preparedOffer: input.preparedOffer,
    trace: trace as PersistedGrowthAgentTraceStep[],
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    completedAt: typeof input.completedAt === "string" ? input.completedAt : undefined,
  };
}

function parseStep(value: unknown): PersistedGrowthAgentTraceStep {
  const input = asRecord(value);
  if (typeof input.step !== "number" || !Number.isInteger(input.step) || input.step < 1 || typeof input.state !== "string" || typeof input.tool !== "string" || typeof input.reason !== "string" || typeof input.status !== "string" || !input.input || typeof input.input !== "object" || Array.isArray(input.input) || typeof input.startedAt !== "string") {
    throw new Error("INVALID_GROWTH_AGENT_STEP");
  }
  return {
    step: input.step,
    state: input.state,
    tool: input.tool,
    reason: input.reason,
    status: input.status,
    input: input.input as Record<string, unknown>,
    output: input.output,
    error: typeof input.error === "string" ? input.error : undefined,
    callId: typeof input.callId === "string" ? input.callId : undefined,
    plannerModel: typeof input.plannerModel === "string" ? input.plannerModel : undefined,
    startedAt: input.startedAt,
    completedAt: typeof input.completedAt === "string" ? input.completedAt : undefined,
    durationMs: typeof input.durationMs === "number" && Number.isInteger(input.durationMs) ? input.durationMs : undefined,
  };
}

export function registerGrowthAgentPersistenceRoutes(app: Application): void {
  app.post("/v1/internal/growth-agent/checkpoints", async (request, response) => {
    try {
      internalSecretOrThrow(request);
      const body = asRecord(request.body);
      const run = parseRun(body.run);
      const step = body.step === undefined || body.step === null ? undefined : parseStep(body.step);
      if (step && step.step !== run.stepCount) throw new Error("GROWTH_AGENT_STEP_RUN_MISMATCH");
      await saveGrowthAgentCheckpoint({ run, step });
      return response.status(201).json({ saved: true, runId: run.id, step: step?.step ?? null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "GROWTH_AGENT_PERSISTENCE_FAILED";
      const status = message.startsWith("UNAUTHORIZED") ? 401 : message.includes("MISMATCH") ? 400 : 422;
      return response.status(status).json({ error: message });
    }
  });

  app.get("/v1/internal/growth-agent/runs/:runId", async (request, response) => {
    try {
      internalSecretOrThrow(request);
      const run = await loadGrowthAgentRun(request.params.runId);
      if (!run) return response.status(404).json({ error: "GROWTH_AGENT_RUN_NOT_FOUND" });
      return response.json({ run });
    } catch (error) {
      const message = error instanceof Error ? error.message : "GROWTH_AGENT_PERSISTENCE_FAILED";
      return response.status(message === "GROWTH_AGENT_RUN_NOT_FOUND" ? 404 : 401).json({ error: message });
    }
  });

  app.get("/v1/internal/growth-agent/runs", async (request, response) => {
    try {
      internalSecretOrThrow(request);
      const campaignId = typeof request.query.campaignId === "string" ? request.query.campaignId : undefined;
      return response.json({ runs: await listGrowthAgentRuns(campaignId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "GROWTH_AGENT_PERSISTENCE_FAILED";
      return response.status(401).json({ error: message });
    }
  });
}
