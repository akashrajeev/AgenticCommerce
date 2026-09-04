import type { BuyerAgentRun } from "./buyer-agent";
import type { BuyerAgentWorkspace, BuyerProduct } from "./buyer-agent-tools";
import { assertBuyerBudget } from "./buyer-agent";

export const BUYER_AGENT_SELECTION_TOOL_NAME = "select_product" as const;

export const BUYER_AGENT_SELECTION_TOOL = {
  type: "function" as const,
  name: BUYER_AGENT_SELECTION_TOOL_NAME,
  description: "Select one observed product as the current buyer choice using the user's immutable constraints.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      productId: { type: "string", minLength: 1, maxLength: 100 },
      reason: { type: "string", minLength: 1, maxLength: 400 },
    },
    required: ["productId", "reason"],
  },
};

export function executeBuyerAgentSelectionTool(
  context: { run: BuyerAgentRun; workspace: BuyerAgentWorkspace },
  rawArguments: unknown,
): { tool: typeof BUYER_AGENT_SELECTION_TOOL_NAME; result: unknown } {
  if (!rawArguments || typeof rawArguments !== "object" || Array.isArray(rawArguments)) {
    throw new Error("BUYER_AGENT_SELECTION_ARGUMENTS_INVALID");
  }
  const args = rawArguments as Record<string, unknown>;
  const productId = typeof args.productId === "string" ? args.productId.trim() : "";
  const reason = typeof args.reason === "string" ? args.reason.trim() : "";
  if (!productId || !reason) throw new Error("BUYER_AGENT_SELECTION_ARGUMENTS_INVALID");

  const product = context.workspace.inspectedProducts[productId]
    ?? context.workspace.catalog?.find((candidate) => candidate.id === productId);
  if (!product) throw new Error("BUYER_AGENT_SELECTION_PRODUCT_NOT_OBSERVED");
  assertBuyerProductEligible(context.run, product);
  context.workspace.selectedProductId = product.id;

  return {
    tool: BUYER_AGENT_SELECTION_TOOL_NAME,
    result: {
      status: "SELECTED",
      productId: product.id,
      name: product.name,
      category: product.category,
      pricePaise: product.pricePaise,
      inventory: product.inventory,
      reason,
    },
  };
}

function assertBuyerProductEligible(run: BuyerAgentRun, product: BuyerProduct): void {
  if (product.inventory < 1) throw new Error("BUYER_AGENT_SELECTED_PRODUCT_OUT_OF_STOCK");
  if (run.constraints.requiredCategory && product.category.toLowerCase() !== run.constraints.requiredCategory.toLowerCase()) {
    throw new Error("BUYER_AGENT_SELECTED_PRODUCT_CATEGORY_MISMATCH");
  }
  if (run.constraints.requiredProductIds?.length && !run.constraints.requiredProductIds.includes(product.id)) {
    throw new Error("BUYER_AGENT_SELECTED_PRODUCT_NOT_ALLOWED");
  }
  assertBuyerBudget(run, product.pricePaise);
}
