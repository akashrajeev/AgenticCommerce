import { catalog, findProduct, MERCHANT_ID } from "./catalog";
import { getRevenueRecommendations, type RevenueRecommendation } from "./revenue";

export type GrowthCampaign = {
  id: string;
  merchantId: string;
  name: string;
  objective: string;
  sourceCategories: string[];
  strategy: "CROSS_SELL" | "UPSELL";
  maxRecommendationPricePaise?: number;
};

export type CampaignOpportunity = RevenueRecommendation & { campaignId: string; sourceProductName: string; productName: string };

export const growthCampaigns: GrowthCampaign[] = [
  {
    id: "headphone-aov",
    merchantId: MERCHANT_ID,
    name: "Headphone AOV lift",
    objective: "Increase basket value after a headphone purchase without bypassing buyer budget or approval.",
    sourceCategories: ["headphones"],
    strategy: "CROSS_SELL",
  },
  {
    id: "desk-setup-aov",
    merchantId: MERCHANT_ID,
    name: "Desk setup expansion",
    objective: "Turn a single desk-device purchase into a complementary setup basket.",
    sourceCategories: ["mice", "keyboards", "monitors", "webcams"],
    strategy: "CROSS_SELL",
  },
];

export function getGrowthCampaign(id: string): GrowthCampaign | undefined {
  return growthCampaigns.find((campaign) => campaign.id === id);
}

export function getCampaignOpportunities(campaign: GrowthCampaign): CampaignOpportunity[] {
  const opportunities: CampaignOpportunity[] = [];
  for (const source of catalog.filter((product) => campaign.sourceCategories.includes(product.category) && product.inventory > 0)) {
    for (const recommendation of getRevenueRecommendations(source.id)) {
      const target = findProduct(recommendation.productId);
      if (!target) continue;
      if (campaign.strategy === "UPSELL" && recommendation.type !== "UPSELL") continue;
      if (campaign.strategy === "CROSS_SELL" && recommendation.type !== "CROSS_SELL") continue;
      if (campaign.maxRecommendationPricePaise !== undefined && target.pricePaise > campaign.maxRecommendationPricePaise) continue;
      opportunities.push({ ...recommendation, campaignId: campaign.id, sourceProductName: source.name, productName: target.name });
    }
  }
  return opportunities.sort((a, b) => b.score - a.score).slice(0, 12);
}
