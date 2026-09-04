import { NextResponse } from "next/server";
import { getBuyerAgentRun } from "@/lib/buyer-agent";
import { getBuyerAgentHistory, getBuyerAgentTrace, runBuyerAgent } from "@/lib/buyer-agent-orchestrator";

function parseInput(value: unknown): {
  objective: string;
  maxSpendPaise: number;
  maxSteps?: number;
  requiredCategory?: string;
  requiredProductIds?: string[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_BUYER_AGENT_REQUEST");
  const body = value as Record<string, unknown>;
  const objective = typeof body.objective === "string" ? body.objective.trim() : "";
  const maxSpendPaise = typeof body.maxSpendPaise === "number" ? body.maxSpendPaise : NaN;
  const maxSteps = body.maxSteps === undefined ? undefined : typeof body.maxSteps === "number" ? body.maxSteps : NaN;
  const requiredCategory = body.requiredCategory === undefined ? undefined : typeof body.requiredCategory === "string" ? body.requiredCategory : "";
  const requiredProductIds = body.requiredProductIds === undefined
    ? undefined
    : Array.isArray(body.requiredProductIds)
      ? body.requiredProductIds.filter((item): item is string => typeof item === "string")
      : [];
  if (!objective || !Number.isSafeInteger(maxSpendPaise) || maxSpendPaise < 0 || (maxSteps !== undefined && (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 20))) {
    throw new Error("INVALID_BUYER_AGENT_REQUEST");
  }
  return { objective, maxSpendPaise, maxSteps, requiredCategory, requiredProductIds };
}

export async function POST(request: Request) {
  try {
    const input = parseInput(await request.json());
    const execution = await runBuyerAgent(input);
    return NextResponse.json({
      run: execution.run,
      workspace: execution.workspace,
      trace: execution.trace,
      plannerCalls: execution.plannerCalls,
      plannerModel: execution.plannerModel,
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "BUYER_AGENT_FAILED";
    const status = message.startsWith("INVALID_") || message.endsWith("_INVALID") ? 400 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId")?.trim();
  if (!runId) return NextResponse.json({ error: "BUYER_AGENT_RUN_ID_REQUIRED" }, { status: 400 });
  const run = getBuyerAgentRun(runId);
  if (!run) return NextResponse.json({ error: "BUYER_AGENT_RUN_NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ run, trace: getBuyerAgentTrace(runId), historyItems: getBuyerAgentHistory(runId).length }, { headers: { "cache-control": "no-store" } });
}
