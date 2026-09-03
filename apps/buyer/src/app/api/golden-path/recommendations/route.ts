import { NextResponse } from "next/server";

const MERCHANT_INTERNAL_URL = process.env.MERCHANT_INTERNAL_URL ?? "http://localhost:3000";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("productId")?.trim() ?? "";
  const maxSpendPaiseRaw = searchParams.get("maxSpendPaise");
  if (!productId) return NextResponse.json({ error: "PRODUCT_ID_REQUIRED" }, { status: 400 });
  const maxSpendPaise = maxSpendPaiseRaw === null ? undefined : Number(maxSpendPaiseRaw);
  if (maxSpendPaiseRaw !== null && (!Number.isSafeInteger(maxSpendPaise) || maxSpendPaise < 0)) return NextResponse.json({ error: "INVALID_SPEND_LIMIT" }, { status: 400 });
  try {
    const suffix = maxSpendPaise === undefined ? "" : `&maxSpendPaise=${encodeURIComponent(String(maxSpendPaise))}`;
    const response = await fetch(`${MERCHANT_INTERNAL_URL}/api/agent/recommendations?productId=${encodeURIComponent(productId)}${suffix}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) return NextResponse.json(body ?? { error: "MERCHANT_RECOMMENDATIONS_FAILED" }, { status: response.status });
    return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "MERCHANT_RECOMMENDATIONS_UNAVAILABLE" }, { status: 502 });
  }
}
