import { NextResponse } from "next/server";
import { getRevenueRecommendations } from "../../../../lib/revenue.js";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("productId");
  const maxSpendRaw = searchParams.get("maxSpendPaise");

  if (!productId) {
    return NextResponse.json({ error: "productId is required" }, { status: 400 });
  }

  const maxSpendPaise = maxSpendRaw ? Number(maxSpendRaw) : undefined;
  if (maxSpendRaw && (!Number.isSafeInteger(maxSpendPaise) || maxSpendPaise < 0)) {
    return NextResponse.json({ error: "maxSpendPaise must be a non-negative integer" }, { status: 400 });
  }

  try {
    return NextResponse.json({
      sourceProductId: productId,
      recommendations: getRevenueRecommendations(productId, maxSpendPaise),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PRODUCT_NOT_FOUND") {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Unable to generate recommendations" }, { status: 500 });
  }
}
