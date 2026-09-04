import { persistBuyerAgentCheckpoint, loadBuyerAgentRun } from "../../../../lib/buyer-agent-persistence";

function authorized(request: Request): boolean {
  const expected = process.env.INTERNAL_GATEWAY_SECRET?.trim();
  const provided = request.headers.get("x-mandate-gateway-secret")?.trim() ?? "";
  return Boolean(expected) && provided === expected;
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "UNAUTHORIZED_GATEWAY" }, { status: 401 });
  const body = await request.json().catch(() => null) as { run?: Record<string, unknown>; step?: Record<string, unknown> } | null;
  if (!body?.run || typeof body.run.id !== "string" || typeof body.run.objective !== "string" || typeof body.run.maxSpendPaise !== "number" || body.run.currency !== "INR" || typeof body.run.maxSteps !== "number" || typeof body.run.state !== "string" || typeof body.run.stepCount !== "number" || typeof body.run.plannerCalls !== "number" || typeof body.run.createdAt !== "string" || typeof body.run.updatedAt !== "string") {
    return Response.json({ error: "INVALID_BUYER_AGENT_RUN" }, { status: 400 });
  }
  try {
    await persistBuyerAgentCheckpoint({
      id: body.run.id,
      objective: body.run.objective,
      maxSpendPaise: body.run.maxSpendPaise,
      currency: "INR",
      maxSteps: body.run.maxSteps,
      state: body.run.state,
      stepCount: body.run.stepCount,
      plannerCalls: body.run.plannerCalls,
      plannerModel: typeof body.run.plannerModel === "string" ? body.run.plannerModel : undefined,
      lastError: typeof body.run.lastError === "string" ? body.run.lastError : undefined,
      workspace: body.run.workspace,
      createdAt: body.run.createdAt,
      updatedAt: body.run.updatedAt,
      completedAt: typeof body.run.completedAt === "string" ? body.run.completedAt : undefined,
    }, body.step as never);
    return Response.json({ saved: true }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "BUYER_AGENT_PERSISTENCE_FAILED" }, { status: 503 });
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "UNAUTHORIZED_GATEWAY" }, { status: 401 });
  const runId = new URL(request.url).searchParams.get("runId")?.trim() ?? "";
  if (!runId) return Response.json({ error: "BUYER_AGENT_RUN_ID_REQUIRED" }, { status: 400 });
  try {
    const data = await loadBuyerAgentRun(runId);
    if (!data) return Response.json({ error: "BUYER_AGENT_RUN_NOT_FOUND" }, { status: 404 });
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "BUYER_AGENT_LOAD_FAILED" }, { status: 503 });
  }
}
