import { NextResponse } from "next/server";
import { buildGrowthAiContext, requestGrowthAiPlan } from "../../../lib/ai-growth";

export const dynamic = "force-dynamic";

const GATEWAY_INTERNAL_URL = (process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");

async function loadConfirmedOrders(): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${GATEWAY_INTERNAL_URL}/v1/merchant/orders`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  const body = await response.json().catch(() => null) as { orders?: unknown } | null;
  if (!response.ok || !Array.isArray(body?.orders)) throw new Error("MERCHANT_ORDER_EVIDENCE_UNAVAILABLE");
  return body.orders.filter((order): order is Record<string, unknown> => Boolean(order && typeof order === "object"));
}

export async function GET() {
  return NextResponse.json({
    configured: Boolean(process.env.OPENAI_API_KEY),
    model: (process.env.OPENAI_MODEL ?? "gpt-5.6").trim(),
    execution: "advisory-only",
    paymentAuthority: "MANDATE + Razorpay Test Mode",
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { objective?: unknown } | null;
  const objective = typeof body?.objective === "string" ? body.objective.trim().slice(0, 500) : "";
  if (!objective) return NextResponse.json({ error: "AI_GROWTH_OBJECTIVE_REQUIRED" }, { status: 400 });

  try {
    const orders = await loadConfirmedOrders();
    const context = buildGrowthAiContext(orders);
    const result = await requestGrowthAiPlan(objective, context);
    return NextResponse.json({
      testModeOnly: true,
      advisoryOnly: true,
      model: result.model,
      plan: result.plan,
      liveEvidence: {
        confirmedOrders: context.confirmedOrders,
        confirmedRevenuePaise: context.confirmedRevenuePaise,
        realizedIncrementalRevenuePaise: context.realizedIncrementalRevenuePaise,
      },
      execution: {
        allowed: false,
        nextRoute: `/campaigns?campaignId=${encodeURIComponent(result.plan.campaignId)}`,
        reason: "AI output cannot execute or authorize payments; merchant campaign execution remains behind MANDATE and Razorpay Test Mode.",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI_GROWTH_FAILED";
    const status = message === "AI_GROWTH_NOT_CONFIGURED" ? 503 : 502;
    return NextResponse.json({ error: message, advisoryOnly: true, paymentAuthority: "MANDATE + Razorpay Test Mode" }, { status });
  }
}
