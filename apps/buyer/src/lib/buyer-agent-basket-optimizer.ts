import type { BuyerAgentRun } from "./buyer-agent";
import type { BuyerAgentWorkspace, BuyerQuote } from "./buyer-agent-tools";
import { assertBuyerBudget } from "./buyer-agent";

export const BUYER_AGENT_BASKET_OPTIMIZER_TOOL_NAME = "optimize_basket" as const;

export const BUYER_AGENT_BASKET_OPTIMIZER_TOOL = {
  type: "function" as const,
  name: BUYER_AGENT_BASKET_OPTIMIZER_TOOL_NAME,
  description: "Evaluate the base product and observed merchant recommendations as fresh quoted basket options within the buyer's immutable budget. It does not choose or authorize a payment.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      recommendationProductIds: {
        type: "array",
        minItems: 0,
        maxItems: 3,
        items: { type: "string", minLength: 1, maxLength: 100 },
      },
    },
    required: ["recommendationProductIds"],
  },
};

export type BuyerBasketOption = {
  optionId: string;
  lineItems: Array<{ productId: string; quantity: number }>;
  totalPaise: number;
  incrementalPaise: number;
  quoteId: string;
  expiresAt: string;
  eligible: boolean;
  rationale: string;
};

function merchantUrl(context: { merchantInternalUrl?: string }): string {
  return (context.merchantInternalUrl ?? process.env.MERCHANT_INTERNAL_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

async function quote(context: { merchantInternalUrl?: string }, lineItems: Array<{ productId: string; quantity: number }>): Promise<BuyerQuote> {
  const response = await fetch(`${merchantUrl(context)}/api/agent/checkout/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lineItems }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json().catch(() => null) as { quote?: BuyerQuote; error?: string } | null;
  if (!response.ok || !body?.quote) throw new Error(`BUYER_AGENT_OPTIMIZER_${body?.error ?? `HTTP_${response.status}`}`);
  if (body.quote.currency !== "INR") throw new Error("BUYER_AGENT_OPTIMIZER_CURRENCY_INVALID");
  return body.quote;
}

export async function executeBuyerAgentBasketOptimizerTool(
  context: { run: BuyerAgentRun; workspace: BuyerAgentWorkspace; merchantInternalUrl?: string },
  rawArguments: unknown,
): Promise<{ tool: typeof BUYER_AGENT_BASKET_OPTIMIZER_TOOL_NAME; result: { options: BuyerBasketOption[]; recommendedOptionId: string | null } }> {
  if (!rawArguments || typeof rawArguments !== "object" || Array.isArray(rawArguments)) throw new Error("BUYER_AGENT_OPTIMIZER_ARGUMENTS_INVALID");
  const args = rawArguments as Record<string, unknown>;
  const ids = Array.isArray(args.recommendationProductIds)
    ? args.recommendationProductIds.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
    : null;
  if (!ids || ids.length > 3) throw new Error("BUYER_AGENT_OPTIMIZER_ARGUMENTS_INVALID");
  const selectedId = context.workspace.selectedProductId;
  if (!selectedId) throw new Error("BUYER_AGENT_OPTIMIZER_SELECTED_PRODUCT_REQUIRED");

  const baseProduct = context.workspace.inspectedProducts[selectedId] ?? context.workspace.catalog?.find((product) => product.id === selectedId);
  if (!baseProduct) throw new Error("BUYER_AGENT_OPTIMIZER_SELECTED_PRODUCT_NOT_OBSERVED");
  if (baseProduct.inventory < 1) throw new Error("BUYER_AGENT_OPTIMIZER_BASE_OUT_OF_STOCK");

  const candidateIds = [...new Set(ids)].filter((id) => id !== selectedId);
  const options: BuyerBasketOption[] = [];
  const baseLine = [{ productId: selectedId, quantity: 1 }];
  const baseQuote = await quote(context, baseLine);
  assertBuyerBudget(context.run, baseQuote.totalPaise);
  options.push({
    optionId: "base",
    lineItems: baseLine,
    totalPaise: baseQuote.totalPaise,
    incrementalPaise: 0,
    quoteId: baseQuote.quoteId,
    expiresAt: baseQuote.expiresAt,
    eligible: true,
    rationale: "Base product only; preserves the maximum amount of unused budget.",
  });

  for (const productId of candidateIds) {
    const recommendation = context.workspace.recommendations.find((item) => item.productId === productId);
    if (!recommendation) continue;
    const candidate = context.workspace.inspectedProducts[productId] ?? context.workspace.catalog?.find((product) => product.id === productId);
    if (!candidate || candidate.inventory < 1) {
      options.push({
        optionId: `with-${productId}`,
        lineItems: [...baseLine, { productId, quantity: 1 }],
        totalPaise: Number.MAX_SAFE_INTEGER,
        incrementalPaise: Number.MAX_SAFE_INTEGER,
        quoteId: "",
        expiresAt: "",
        eligible: false,
        rationale: "Candidate is not currently available to the buyer agent.",
      });
      continue;
    }
    const lines = [...baseLine, { productId, quantity: 1 }];
    const candidateQuote = await quote(context, lines);
    const eligible = candidateQuote.totalPaise <= context.run.constraints.maxSpendPaise;
    const incrementalPaise = Math.max(candidateQuote.totalPaise - baseQuote.totalPaise, 0);
    options.push({
      optionId: `with-${productId}`,
      lineItems: lines,
      totalPaise: candidateQuote.totalPaise,
      incrementalPaise,
      quoteId: candidateQuote.quoteId,
      expiresAt: candidateQuote.expiresAt,
      eligible,
      rationale: eligible ? recommendation.rationale : "Fresh quote exceeds the buyer's immutable spending limit.",
    });
  }

  const eligible = options.filter((option) => option.eligible);
  const recommended = eligible
    .filter((option) => option.lineItems.length > 1)
    .sort((a, b) => a.incrementalPaise - b.incrementalPaise)[0]
    ?? eligible[0]
    ?? null;

  return {
    tool: BUYER_AGENT_BASKET_OPTIMIZER_TOOL_NAME,
    result: {
      options,
      recommendedOptionId: recommended?.optionId ?? null,
    },
  };
}
