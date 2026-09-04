import { planBuyerIntent } from "@mandate/shared";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { request?: unknown; maxSpendPaise?: unknown } | null;
  const requestText = typeof body?.request === "string" ? body.request.trim() : "";
  const maxSpendPaise = typeof body?.maxSpendPaise === "number" ? body.maxSpendPaise : NaN;
  if (!requestText || !Number.isSafeInteger(maxSpendPaise) || maxSpendPaise <= 0) return Response.json({ error: "INVALID_BUYER_INTENT_PLAN_REQUEST" }, { status: 400 });
  try {
    const plan = await planBuyerIntent(requestText, maxSpendPaise);
    return Response.json({ plan, paymentAuthority: "MANDATE policy core", budgetSource: "caller-supplied hard limit" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "BUYER_INTENT_PLAN_FAILED" }, { status: 422 });
  }
}
