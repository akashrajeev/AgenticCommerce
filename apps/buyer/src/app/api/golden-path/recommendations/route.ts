import { NextResponse } from "next/server";

const MERCHANT_INTERNAL_URL = process.env.MERCHANT_INTERNAL_URL ?? "http://localhost:3000";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("productId")?.trim() ?? "";
  const maxSpendRaw = searchParams.get("maxSpendPaise");
  if (!productId) return NextResponse.json({ error: "PRODUCT_ID_REQUIRED" }, { status: 400 });

  if (maxSpendRaw === null) {
    try {
      const response = await fetch(`${MERCHANT_INTERNAL_URL}/api/agent/recommendations?productId=${encodeURIComponent(productId)}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) return NextResponse.json(body ?? { error: "MERCHANT_RECOMMENDATIONS_FAILED" }, { status: response.status });
      return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
    } catch {
      return NextResponse.json({ error: "MERCHANT_RECOMMENDATIONS_UNAVAILABLE" }, { status: 502 });
    }
  }

  const parsedMaxSpendPaise = Number(maxSpendRaw);
  if (!Number.isSafeInteger(parsedMaxSpendPaise) || parsedMaxSpendPaise < 0) return NextResponse.json({ error: "INVALID_SPEND_LIMIT" }, { status: 400 });

  try {
    const response = await fetch(`${MERCHANT_INTERNAL_URL}/api/agent/recommendations?productId=${encodeURIComponent(productId)}&maxSpendPaise=${encodeURIComponent(String(parsedMaxSpendPaise))}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) return NextResponse.json(body ?? { error: "MERCHANT_RECOMMENDATIONS_FAILED" }, { status: response.status });
    return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "MERCHANT_RECOMMENDATIONS_UNAVAILABLE" }, { status: 502 });
  }
}
