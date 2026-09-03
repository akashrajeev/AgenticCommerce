import { NextResponse } from "next/server";
import { buildMultiLineQuote, findProduct, MERCHANT_ID } from "../../../../lib/catalog";
import { getRevenueRecommendations } from "../../../../lib/revenue";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sourceProductId = searchParams.get("productId");
  const maxSpendRaw = searchParams.get("maxSpendPaise");
  if (!sourceProductId) return NextResponse.json({ error: "productId is required" }, { status: 400 });

  const source = findProduct(sourceProductId);
  if (!source) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  let maxSpendPaise: number | undefined;
  if (maxSpendRaw !== null) {
    maxSpendPaise = Number(maxSpendRaw);
    if (!Number.isSafeInteger(maxSpendPaise) || maxSpendPaise < 0) return NextResponse.json({ error: "maxSpendPaise must be a non-negative integer" }, { status: 400 });
  }

  const sourceQuote = buildMultiLineQuote([{ productId: source.id, quantity: 1 }]);
  const recommendations = getRevenueRecommendations(source.id, maxSpendPaise);
  const generatedAt = new Date().toISOString();
  const opportunities = recommendations.map((recommendation) => {
    const bundleItems = recommendation.type === "UPSELL"
      ? [{ productId: recommendation.productId, quantity: 1 }]
      : [{ productId: source.id, quantity: 1 }, { productId: recommendation.productId, quantity: 1 }];
    const bundleQuote = buildMultiLineQuote(bundleItems);
    const incrementalRevenuePaise = Math.max(bundleQuote.subtotalPaise - sourceQuote.subtotalPaise, 0);
    const budgetFit = maxSpendPaise === undefined || bundleQuote.totalPaise <= maxSpendPaise;
    return {
      opportunityId: `grow_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`,
      merchantId: MERCHANT_ID,
      sourceProductId: source.id,
      recommendedProductId: recommendation.productId,
      type: recommendation.type,
      score: recommendation.score,
      rationale: recommendation.rationale,
      incrementalRevenue: { currency: "INR" as const, amountPaise: incrementalRevenuePaise },
      projectedBasket: { currency: "INR" as const, amountPaise: bundleQuote.totalPaise },
      budgetFit,
      sourceQuoteId: sourceQuote.quoteId,
      bundleQuoteId: bundleQuote.quoteId,
      createdAt: generatedAt,
      expiresAt: bundleQuote.expiresAt,
    };
  });

  return NextResponse.json({
    sourceProduct: source,
    sourceQuote,
    maxSpendPaise: maxSpendPaise ?? null,
    opportunities,
    generatedAt,
  }, { headers: { "cache-control": "no-store" } });
}
