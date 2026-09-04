import { NextResponse } from "next/server";
import {
  createGrowthAgentRun,
  getGrowthAgentRun,
  listGrowthAgentRuns,
  runGrowthAgent,
} from "../../../../lib/growth-agent";

export const dynamic = "force-dynamic";

function serializeRun(run: ReturnType<typeof createGrowthAgentRun>) {
  return {
    ...run,
    paymentAuthority: "MANDATE + Razorpay Test Mode",
    advisoryUntilAuthorization: true,
    testModeOnly: true,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId");
  if (runId) {
    const run = getGrowthAgentRun(runId);
    if (!run) return NextResponse.json({ error: "GROWTH_AGENT_RUN_NOT_FOUND" }, { status: 404 });
    return NextResponse.json(serializeRun(run), { headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json({
    testModeOnly: true,
    runs: listGrowthAgentRuns().map(serializeRun),
  }, { headers: { "cache-control": "no-store" } });
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
