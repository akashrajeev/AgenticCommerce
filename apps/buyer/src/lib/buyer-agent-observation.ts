import type { BuyerAgentRun } from "./buyer-agent";
import type { BuyerAgentWorkspace } from "./buyer-agent-tools";

export type BuyerAgentObservation = {
  objective: string;
  state: BuyerAgentRun["state"];
  constraints: {
    maxSpendPaise: number;
    currency: "INR";
    maxSteps: number;
    requiredCategory?: string;
    requiredProductIds?: readonly string[];
  };
  merchant: {
    discovered: boolean;
    merchantId?: string;
    name?: string;
    version?: string;
  };
  catalog: {
    loaded: boolean;
    count: number;
    products: Array<{
      productId: string;
      name: string;
      category: string;
      pricePaise: number;
      rating: number;
      inventory: number;
      features: string[];
    }>;
  };
  inspectedProductIds: string[];
  inventory: Record<string, number>;
  selectedProductId?: string;
  recommendations: Array<{
    productId: string;
    type: "UPSELL" | "CROSS_SELL";
    score: number;
    rationale: string;
    incrementalRevenuePaise: number;
  }>;
  basket: Array<{ productId: string; quantity: number }>;
  latestQuote?: {
    quoteId: string;
    totalPaise: number;
    currency: "INR";
    expiresAt: string;
    lineItems: Array<{ productId: string; quantity: number; unitPricePaise: number; lineTotalPaise: number }>;
  };
};

export function buildBuyerAgentObservation(run: BuyerAgentRun, workspace: BuyerAgentWorkspace): BuyerAgentObservation {
  return {
    objective: run.objective,
    state: run.state,
    constraints: {
      maxSpendPaise: run.constraints.maxSpendPaise,
      currency: "INR",
      maxSteps: run.constraints.maxSteps,
      ...(run.constraints.requiredCategory ? { requiredCategory: run.constraints.requiredCategory } : {}),
      ...(run.constraints.requiredProductIds?.length ? { requiredProductIds: [...run.constraints.requiredProductIds] } : {}),
    },
    merchant: {
      discovered: Boolean(workspace.manifest),
      ...(workspace.manifest ? {
        merchantId: workspace.manifest.merchantId,
        name: workspace.manifest.name,
        version: workspace.manifest.version,
      } : {}),
    },
    catalog: {
      loaded: Boolean(workspace.catalog),
      count: workspace.catalog?.length ?? 0,
      products: (workspace.catalog ?? []).slice(0, 20).map((product) => ({
        productId: product.id,
        name: product.name,
        category: product.category,
        pricePaise: product.pricePaise,
        rating: product.rating,
        inventory: product.inventory,
        features: product.features.slice(0, 12),
      })),
    },
    inspectedProductIds: Object.keys(workspace.inspectedProducts).slice(0, 20),
    inventory: Object.fromEntries(Object.entries(workspace.inventory).slice(0, 20)),
    ...(workspace.selectedProductId ? { selectedProductId: workspace.selectedProductId } : {}),
    recommendations: workspace.recommendations.slice(0, 10).map((recommendation) => ({
      productId: recommendation.productId,
      type: recommendation.type,
      score: recommendation.score,
      rationale: recommendation.rationale,
      incrementalRevenuePaise: recommendation.incrementalRevenuePaise,
    })),
    basket: workspace.basket.map((line) => ({ ...line })),
    ...(workspace.latestQuote ? {
      latestQuote: {
        quoteId: workspace.latestQuote.quoteId,
        totalPaise: workspace.latestQuote.totalPaise,
        currency: "INR",
        expiresAt: workspace.latestQuote.expiresAt,
        lineItems: workspace.latestQuote.lineItems.map((line) => ({ ...line })),
      },
    } : {}),
  };
}
