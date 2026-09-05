import { catalog, findProduct } from "./catalog";
import { getCampaignOpportunities, growthCampaigns } from "./campaigns";

export type GrowthAiPlan = {
  campaignId: string;
  strategy: "CROSS_SELL" | "UPSELL";
  sourceProductId: string;
  targetProductId: string;
  audience: string;
  rationale: string;
  evidence: Array<{ metric: string; value: string }>;
  guardrails: string[];
  expectedIncrementalRevenuePaise: number;
  confidence: number;
};

export type GrowthAiContext = {
  campaigns: Array<{
    id: string;
    name: string;
    objective: string;
    strategy: string;
    opportunities: Array<{
      sourceProductId: string;
      sourceProductName: string;
      targetProductId: string;
      targetProductName: string;
      score: number;
      incrementalRevenuePaise: number;
      rationale: string;
    }>;
  }>;
  catalog: Array<{
    id: string;
    name: string;
    category: string;
    pricePaise: number;
    inventory: number;
    rating: number;
    reviewCount: number;
  }>;
  confirmedOrders: number;
  confirmedRevenuePaise: number;
  realizedIncrementalRevenuePaise: number;
  testModeOnly: true;
};

function numeric(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function buildGrowthAiContext(confirmedOrders: Array<Record<string, unknown>>): GrowthAiContext {
  return {
    campaigns: growthCampaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      objective: campaign.objective,
      strategy: campaign.strategy,
      opportunities: getCampaignOpportunities(campaign).map((opportunity) => ({
        sourceProductId: opportunity.sourceProductId,
        sourceProductName: opportunity.sourceProductName,
        targetProductId: opportunity.productId,
        targetProductName: opportunity.productName,
        score: opportunity.score,
        incrementalRevenuePaise: opportunity.incrementalRevenuePaise,
        rationale: opportunity.rationale,
      })),
    })),
    catalog: catalog.map((product) => ({
      id: product.id,
      name: product.name,
      category: product.category,
      pricePaise: product.pricePaise,
      inventory: product.inventory,
      rating: product.rating,
      reviewCount: product.reviewCount,
    })),
    confirmedOrders: confirmedOrders.length,
    confirmedRevenuePaise: confirmedOrders.reduce((sum, order) => sum + numeric(order.amountPaise), 0),
    realizedIncrementalRevenuePaise: confirmedOrders.reduce((sum, order) => sum + numeric(order.incrementalRevenuePaise), 0),
    testModeOnly: true,
  };
}

export function validateGrowthAiPlan(value: unknown, context: GrowthAiContext): GrowthAiPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AI_GROWTH_INVALID_PLAN");
  const plan = value as Record<string, unknown>;
  const campaignId = typeof plan.campaignId === "string" ? plan.campaignId : "";
  const strategy = plan.strategy === "CROSS_SELL" || plan.strategy === "UPSELL" ? plan.strategy : null;
  const sourceProductId = typeof plan.sourceProductId === "string" ? plan.sourceProductId : "";
  const targetProductId = typeof plan.targetProductId === "string" ? plan.targetProductId : "";
  const audience = typeof plan.audience === "string" ? plan.audience.trim() : "";
  const rationale = typeof plan.rationale === "string" ? plan.rationale.trim() : "";
  const evidence = Array.isArray(plan.evidence)
    ? plan.evidence
        .filter((item): item is { metric: string; value: string } => Boolean(
          item &&
          typeof item === "object" &&
          typeof (item as Record<string, unknown>).metric === "string" &&
          typeof (item as Record<string, unknown>).value === "string",
        ))
        .map((item) => ({ metric: item.metric.slice(0, 100), value: item.value.slice(0, 160) }))
    : [];
  const guardrails = Array.isArray(plan.guardrails)
    ? plan.guardrails.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 160)).slice(0, 8)
    : [];
  const confidence = numeric(plan.confidence, -1);
  const expectedIncrementalRevenuePaise = numeric(plan.expectedIncrementalRevenuePaise, -1);

  const campaign = context.campaigns.find((item) => item.id === campaignId);
  const source = findProduct(sourceProductId);
  const target = findProduct(targetProductId);
  const opportunity = campaign?.opportunities.find(
    (item) =>
      item.sourceProductId === sourceProductId &&
      item.targetProductId === targetProductId &&
      ((strategy === "CROSS_SELL" && campaign.strategy === "CROSS_SELL") ||
        (strategy === "UPSELL" && campaign.strategy === "UPSELL")),
  );

  if (!campaign || !strategy || !source || !target || !opportunity || !audience || !rationale) {
    throw new Error("AI_GROWTH_PLAN_OUTSIDE_ALLOWED_CATALOG");
  }
  if (target.inventory <= 0) throw new Error("AI_GROWTH_TARGET_OUT_OF_STOCK");
  if (!Number.isInteger(expectedIncrementalRevenuePaise) || expectedIncrementalRevenuePaise < 0 || expectedIncrementalRevenuePaise > opportunity.incrementalRevenuePaise) {
    throw new Error("AI_GROWTH_EXPECTED_VALUE_UNTRUSTED");
  }
  if (!(confidence >= 0 && confidence <= 1)) throw new Error("AI_GROWTH_CONFIDENCE_INVALID");

  return {
    campaignId,
    strategy,
    sourceProductId,
    targetProductId,
    audience,
    rationale,
    evidence: evidence.slice(0, 6),
    guardrails,
    expectedIncrementalRevenuePaise,
    confidence,
  };
}

function extractOutputText(body: Record<string, unknown> | null): string {
  const output = Array.isArray(body?.output) ? body.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string") chunks.push(text);
    }
  }
  return chunks.join("\n").trim();
}

export async function requestGrowthAiPlan(objective: string, context: GrowthAiContext): Promise<{ plan: GrowthAiPlan; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("AI_GROWTH_NOT_CONFIGURED");
  const model = (process.env.OPENAI_MODEL ?? "gpt-5.6").trim();
  const baseUrl = (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      store: false,
      instructions: "You are a merchant growth agent. Use only the supplied merchant catalog and existing campaign opportunities. Recommend exactly one existing campaign opportunity. Never invent campaign IDs, product IDs, prices, inventory, payments, customers, or revenue. Your output is advisory only and must never authorize or execute a payment. Expected incremental revenue must be no more than the selected opportunity's actual incrementalRevenuePaise. Clearly distinguish live evidence from future expectation.",
      input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify({ objective, context }) }] }],
      text: {
        format: {
          type: "json_schema",
          name: "merchant_growth_plan",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              campaignId: { type: "string" },
              strategy: { type: "string", enum: ["CROSS_SELL", "UPSELL"] },
              sourceProductId: { type: "string" },
              targetProductId: { type: "string" },
              audience: { type: "string" },
              rationale: { type: "string" },
              evidence: { type: "array", items: { type: "object", additionalProperties: false, properties: { metric: { type: "string" }, value: { type: "string" } }, required: ["metric", "value"] } },
              guardrails: { type: "array", items: { type: "string" } },
              expectedIncrementalRevenuePaise: { type: "integer", minimum: 0 },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["campaignId", "strategy", "sourceProductId", "targetProductId", "audience", "rationale", "evidence", "guardrails", "expectedIncrementalRevenuePaise", "confidence"],
          },
        },
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(`AI_GROWTH_HTTP_${response.status}`);
  const outputText = extractOutputText(body);
  if (!outputText) throw new Error("AI_GROWTH_EMPTY_RESPONSE");
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error("AI_GROWTH_INVALID_JSON");
  }
  return { plan: validateGrowthAiPlan(parsed, context), model };
}
