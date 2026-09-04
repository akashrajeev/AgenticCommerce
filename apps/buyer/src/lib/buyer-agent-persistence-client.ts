import type { BuyerAgentRun } from "./buyer-agent";
import type { BuyerAgentTraceStep } from "./buyer-agent-orchestrator";
import type { BuyerAgentWorkspace } from "./buyer-agent-tools";

const DEFAULT_MERCHANT_URL = "http://localhost:3000";

function merchantUrl(): string {
  return (process.env.MERCHANT_INTERNAL_URL ?? DEFAULT_MERCHANT_URL).replace(/\/$/, "");
}

function authHeaders(): Record<string, string> {
  const secret = process.env.INTERNAL_GATEWAY_SECRET?.trim();
  if (!secret) throw new Error("BUYER_AGENT_PERSISTENCE_SECRET_NOT_CONFIGURED");
  return { "content-type": "application/json", "x-mandate-gateway-secret": secret };
}

export async function persistBuyerAgentCheckpointClient(input: {
  run: BuyerAgentRun;
  workspace: BuyerAgentWorkspace;
  plannerCalls: number;
  plannerModel?: string;
  step?: BuyerAgentTraceStep;
}): Promise<void> {
  if (process.env.BUYER_AGENT_PERSISTENCE_DISABLED === "1") return;
  const response = await fetch(`${merchantUrl()}/api/internal/buyer-agent`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      run: {
        id: input.run.id,
        objective: input.run.objective,
        maxSpendPaise: input.run.constraints.maxSpendPaise,
        currency: input.run.constraints.currency,
        maxSteps: input.run.constraints.maxSteps,
        state: input.run.state,
        stepCount: input.run.stepCount,
        plannerCalls: input.plannerCalls,
        plannerModel: input.plannerModel,
        lastError: input.run.lastError,
        createdAt: input.run.createdAt,
        updatedAt: input.run.updatedAt,
        completedAt: input.run.completedAt,
        workspace: input.workspace,
      },
      step: input.step,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `BUYER_AGENT_PERSISTENCE_HTTP_${response.status}`);
  }
}

export async function loadBuyerAgentRunClient(runId: string): Promise<unknown> {
  if (process.env.BUYER_AGENT_PERSISTENCE_DISABLED === "1") return undefined;
  const response = await fetch(`${merchantUrl()}/api/internal/buyer-agent?runId=${encodeURIComponent(runId)}`, {
    headers: authHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 404) return undefined;
  const body = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(body?.error ?? `BUYER_AGENT_LOAD_HTTP_${response.status}`);
  return body;
}
