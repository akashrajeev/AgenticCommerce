import { NextResponse } from "next/server";
import {
  createGrowthAgentRun,
  getGrowthAgentRun,
  listGrowthAgentRuns,
  runGrowthAgent,
} from "../../../../lib/growth-agent";
import { listPersistedGrowthAgentRuns, loadPersistedGrowthAgentRun } from "../../../../lib/growth-agent-persistence";

export const dynamic = "force-dynamic";

function serializeRun(run: ReturnType<typeof createGrowthAgentRun>) {
  return {
    ...run,
    paymentAuthority: "MANDATE + Razorpay Test Mode",
    advisoryUntilAuthorization: true,
    testModeOnly: true,
    persistence: "postgresql",
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId");
  try {
    if (runId) {
      const live = getGrowthAgentRun(runId);
      if (live) return NextResponse.json(serializeRun(live), { headers: { "cache-control": "no-store" } });
      const persisted = await loadPersistedGrowthAgentRun(runId);
      if (!persisted) return NextResponse.json({ error: "GROWTH_AGENT_RUN_NOT_FOUND" }, { status: 404 });
      return NextResponse.json(serializeRun(persisted as ReturnType<typeof createGrowthAgentRun>), { headers: { "cache-control": "no-store" } });
    }

    const liveRuns = listGrowthAgentRuns();
    const persistedRuns = await listPersistedGrowthAgentRuns();
    const merged = new Map<string, ReturnType<typeof createGrowthAgentRun>>();
    for (const run of persistedRuns) merged.set(run.id, run as ReturnType<typeof createGrowthAgentRun>);
    for (const run of liveRuns) merged.set(run.id, run);
    const runs = [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return NextResponse.json({ testModeOnly: true, runs: runs.map(serializeRun) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GROWTH_AGENT_PERSISTENCE_FAILED";
    return NextResponse.json({ error: message, testModeOnly: true, persistence: "postgresql" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    objective?: unknown;
    campaignId?: unknown;
    maxSpendPaise?: unknown;
    maxSteps?: unknown;
  } | null;

  const objective = typeof body?.objective === "string" ? body.objective : "";
  const campaignId = typeof body?.campaignId === "string" ? body.campaignId : "";
  const maxSpendPaise = body?.maxSpendPaise === undefined ? undefined : Number(body.maxSpendPaise);
  const maxSteps = body?.maxSteps === undefined ? undefined : Number(body.maxSteps);

  try {
    const run = createGrowthAgentRun({ objective, campaignId, maxSpendPaise, maxSteps });
    const completed = await runGrowthAgent(run.id);
    return NextResponse.json(serializeRun(completed), { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GROWTH_AGENT_FAILED";
    const clientErrors = new Set([
      "GROWTH_AGENT_OBJECTIVE_REQUIRED",
      "GROWTH_AGENT_CAMPAIGN_NOT_FOUND",
      "GROWTH_AGENT_MAX_SPEND_INVALID",
      "GROWTH_AGENT_MAX_STEPS_INVALID",
    ]);
    return NextResponse.json({
      error: message,
      testModeOnly: true,
      paymentAuthority: "MANDATE + Razorpay Test Mode",
    }, { status: clientErrors.has(message) ? 400 : 502 });
  }
}
