import { catalog, findProduct, MERCHANT_ID } from "./catalog";

export type RevenueRecommendation = {
  merchantId: string;
  sourceProductId: string;
  productId: string;
  type: "UPSELL" | "CROSS_SELL";
  score: number;
  rationale: string;
  incrementalRevenuePaise: number;
};

const crossSellCategories: Record<string, string[]> = {
  headphones: ["mice", "keyboards", "monitors"],
  keyboards: ["mice", "headphones", "monitors"],
  mice: ["keyboards", "headphones", "monitors"],
  monitors: ["keyboards", "mice", "webcams", "headphones"],
  webcams: ["headphones", "monitors", "keyboards"],
  smartwatches: ["headphones"],
};

export function getRevenueRecommendations(sourceProductId: string, maxSpendPaise?: number): RevenueRecommendation[] {
  const source = findProduct(sourceProductId);
  if (!source) throw new Error("PRODUCT_NOT_FOUND");

  const candidates = catalog
    .filter((product) => product.id !== source.id && product.inventory > 0)
    .map((product): RevenueRecommendation => {
      const sharedTags = product.tags.filter((tag) => source.tags.includes(tag)).length;
      const isSameCategory = product.category === source.category;
      const isCrossSell = crossSellCategories[source.category]?.includes(product.category) ?? false;
      const ratingLift = Math.max(0, product.rating - source.rating);
      const priceRatio = product.pricePaise / source.pricePaise;
      const affordable = maxSpendPaise === undefined || source.pricePaise + product.pricePaise <= maxSpendPaise;

      let score = product.rating * 10 + Math.min(product.reviewCount / 100, 15) + sharedTags * 8;
      let type: RevenueRecommendation["type"] = "CROSS_SELL";
      let rationale = `Complements ${source.name} with a ${product.category} addition to the setup.`;

      if (isSameCategory) {
        score += 18 + ratingLift * 20;
        type = "UPSELL";
        rationale = product.pricePaise > source.pricePaise
          ? `A higher-tier ${product.category} with ${product.rating.toFixed(1)}★ rating can increase basket value.`
          : `An alternative ${product.category} option with strong customer proof.`;
      } else if (isCrossSell) {
        score += 22;
      }

      if (priceRatio > 1.5) score -= 12;
      if (!affordable) score -= 40;

      return {
        merchantId: MERCHANT_ID,
        sourceProductId: source.id,
        productId: product.id,
        type,
        score: Math.round(score * 10) / 10,
        rationale,
        incrementalRevenuePaise: product.pricePaise,
      };
    })
    .filter((recommendation) => recommendation.score > 20)
    .sort((a, b) => b.score - a.score);

  return candidates.slice(0, 4);
}
