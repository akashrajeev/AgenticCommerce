import { NextResponse } from "next/server";

const MERCHANT_INTERNAL_URL = process.env.MERCHANT_INTERNAL_URL ?? "http://localhost:3000";

type Recommendation = Record<string, unknown>;
type NormalizedRecommendation = Recommendation & { quantity: number };

function normalizeRecommendations(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.recommendations)) return body;

  const recommendations: NormalizedRecommendation[] = record.recommendations
    .filter((item): item is Recommendation => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .map((recommendation): NormalizedRecommendation => ({
      ...recommendation,
      quantity: Number.isSafeInteger(recommendation.quantity) && Number(recommendation.quantity) > 0
        ? Number(recommendation.quantity)
        : 1,
    }));

  // The canonical growth demo needs a complementary product so an approved
  // add-on matches the merchant's CROSS_SELL campaign and creates attributable
  // incremental revenue. Keep upsells available as fallback, but prefer a
  // campaign-eligible cross-sell first.
  const crossSell = recommendations.filter((item) => item.type === "CROSS_SELL");
  const fallback = recommendations.filter((item) => item.type !== "CROSS_SELL");

  return {
    ...record,
    recommendations: [...crossSell, ...fallback].slice(0, 2),
  };
}

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
      return NextResponse.json(normalizeRecommendations(body), { headers: { "cache-control": "no-store" } });
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
    return NextResponse.json(normalizeRecommendations(body), { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "MERCHANT_RECOMMENDATIONS_UNAVAILABLE" }, { status: 502 });
  }
}
