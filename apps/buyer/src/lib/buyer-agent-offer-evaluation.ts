import type { BuyerAgentRun } from "./buyer-agent";
import type { BuyerAgentWorkspace } from "./buyer-agent-tools";
import { assertBuyerBudget } from "./buyer-agent";

export const BUYER_AGENT_OFFER_EVALUATION_TOOL_NAME = "evaluate_merchant_offer" as const;

export const BUYER_AGENT_OFFER_EVALUATION_TOOL = {
  type: "function" as const,
  name: BUYER_AGENT_OFFER_EVALUATION_TOOL_NAME,
  description: "Accept or reject a merchant-published upsell/cross-sell based on the user's objective and immutable budget.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      productId: { type: "string", minLength: 1, maxLength: 100 },
      decision: { type: "string", enum: ["accept", "reject"] },
      reason: { type: "string", minLength: 1, maxLength: 400 },
    },
    required: ["productId", "decision", "reason"],
  },
};

export function executeBuyerAgentOfferEvaluationTool(
  context: { run: BuyerAgentRun; workspace: BuyerAgentWorkspace },
  rawArguments: unknown,
): { tool: typeof BUYER_AGENT_OFFER_EVALUATION_TOOL_NAME; result: unknown } {
  if (!rawArguments || typeof rawArguments !== "object" || Array.isArray(rawArguments)) {
    throw new Error("BUYER_AGENT_OFFER_EVALUATION_ARGUMENTS_INVALID");
  }
  const args = rawArguments as Record<string, unknown>;
  const productId = typeof args.productId === "string" ? args.productId.trim() : "";
  const decision = args.decision;
  const reason = typeof args.reason === "string" ? args.reason.trim() : "";
  if (!productId || (decision !== "accept" && decision !== "reject") || !reason) {
    throw new Error("BUYER_AGENT_OFFER_EVALUATION_ARGUMENTS_INVALID");
  }

  const recommendation = context.workspace.recommendations.find((item) => item.productId === productId);
  if (!recommendation) throw new Error("BUYER_AGENT_OFFER_NOT_OBSERVED");

  const candidate = context.workspace.inspectedProducts[productId]
    ?? context.workspace.catalog?.find((product) => product.id === productId);
  if (!candidate) throw new Error("BUYER_AGENT_OFFER_PRODUCT_NOT_OBSERVED");
  if (candidate.inventory < 1) throw new Error("BUYER_AGENT_OFFER_OUT_OF_STOCK");
  if (decision === "accept") assertBuyerBudget(context.run, candidate.pricePaise);

  return {
    tool: BUYER_AGENT_OFFER_EVALUATION_TOOL_NAME,
    result: {
      status: decision === "accept" ? "ACCEPTED" : "REJECTED",
      productId,
      recommendationType: recommendation.type,
      rationale: recommendation.rationale,
      reason,
      candidatePricePaise: candidate.pricePaise,
      inventory: candidate.inventory,
      nextAction: decision === "accept" ? "BUILD_BASKET_OR_REFRESH_QUOTE" : "CONTINUE_WITHOUT_OFFER",
    },
  };
}
