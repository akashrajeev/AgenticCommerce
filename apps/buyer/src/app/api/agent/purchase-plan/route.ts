import { catalog, merchantManifest } from "../../../../../../merchant/src/lib/catalog";

const model = process.env.OPENAI_MODEL ?? "gpt-5.6-luna";
const apiKey = process.env.OPENAI_API_KEY ?? "";
const merchantInternalUrl = process.env.MERCHANT_INTERNAL_URL ?? "http://localhost:3000";
const openAiBaseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");

const planSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string" },
    requirements: { type: "array", items: { type: "string" }, maxItems: 8 },
    rankedProducts: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          productId: { type: "string" },
          score: { type: "number" },
          rationale: { type: "string" },
        },
        required: ["productId", "score", "rationale"],
      },
    },
    selectedProductId: { type: "string" },
    decisionSummary: { type: "string" },
  },
  required: ["category", "requirements", "rankedProducts", "selectedProductId", "decisionSummary"],
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { request?: unknown; maxSpendPaise?: unknown } | null;
  const userRequest = typeof body?.request === "string" ? body.request.trim() : "";
  const maxSpendPaise = typeof body?.maxSpendPaise === "number" ? body.maxSpendPaise : NaN;

  if (!userRequest || !Number.isInteger(maxSpendPaise) || maxSpendPaise < 0) {
    return Response.json({ error: "INVALID_BUYER_REQUEST" }, { status: 400 });
  }

  if (!apiKey) {
    return Response.json({ error: "OPENAI_API_KEY_NOT_CONFIGURED" }, { status: 503 });
  }

  // Read the live merchant contract and catalog before asking the model to choose.
  const manifestResponse = await fetch(`${merchantInternalUrl}/.well-known/agent-commerce`, { cache: "no-store" });
  const catalogResponse = await fetch(`${merchantInternalUrl}/api/agent/catalog`, { cache: "no-store" });
  if (!manifestResponse.ok || !catalogResponse.ok) {
    return Response.json({ error: "MERCHANT_DISCOVERY_FAILED" }, { status: 502 });
  }

  const manifest = (await manifestResponse.json()) as typeof merchantManifest;
  const catalogBody = (await catalogResponse.json()) as { products: typeof catalog };
  const productContext = catalogBody.products.map((product) => ({
    id: product.id,
    name: product.name,
    category: product.category,
    pricePaise: product.pricePaise,
    rating: product.rating,
    inventory: product.inventory,
    features: product.features,
    specifications: product.specifications,
  }));

  const response = await fetch(`${openAiBaseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "You are the shopping planner inside MANDATE.",
                "You may recommend and rank products, but you never authorize payment, change the user's spending limit, or claim a payment occurred.",
                "Use only product IDs and facts present in the supplied merchant catalog.",
                "The hard spending limit is supplied by the application and is immutable for this request.",
                "Prefer products that satisfy explicit requirements and stay within the hard limit. If nothing qualifies, select the strongest available match so the deterministic policy engine can block it visibly.",
                "Return concise user-facing reasons, not hidden chain-of-thought.",
              ].join(" "),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                request: userRequest,
                hardMaxSpendPaise: maxSpendPaise,
                merchant: manifest,
                products: productContext,
              }),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "mandate_purchase_plan",
          description: "A bounded product recommendation plan. It does not authorize payment.",
          schema: planSchema,
          strict: true,
        },
      },
    }),
  });

  const responseBody = (await response.json().catch(() => null)) as { output_text?: string; error?: { message?: string } } | null;
  if (!response.ok || !responseBody?.output_text) {
    return Response.json(
      { error: "MODEL_PLANNING_FAILED", detail: responseBody?.error?.message ?? "The model did not return a purchase plan." },
      { status: 502 },
    );
  }

  let plan: {
    category: string;
    requirements: string[];
    rankedProducts: Array<{ productId: string; score: number; rationale: string }>;
    selectedProductId: string;
    decisionSummary: string;
  };

  try {
    plan = JSON.parse(responseBody.output_text) as typeof plan;
  } catch {
    return Response.json({ error: "MODEL_PLAN_INVALID" }, { status: 502 });
  }

  const validIds = new Set(productContext.map((product) => product.id));
  if (!validIds.has(plan.selectedProductId) || plan.rankedProducts.some((item) => !validIds.has(item.productId))) {
    return Response.json({ error: "MODEL_SELECTED_UNKNOWN_PRODUCT" }, { status: 502 });
  }

  const selected = productContext.find((product) => product.id === plan.selectedProductId);
  if (!selected) return Response.json({ error: "MODEL_SELECTED_UNKNOWN_PRODUCT" }, { status: 502 });

  return Response.json({
    plan,
    selectedProduct: selected,
    merchantId: manifest.merchantId,
    model,
  });
}
