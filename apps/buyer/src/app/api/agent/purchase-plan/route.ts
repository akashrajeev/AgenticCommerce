type Product = {
  id: string;
  name: string;
  category: string;
  pricePaise: number;
  rating: number;
  inventory: number;
  features: string[];
  specifications: Record<string, string>;
};

type MerchantManifest = {
  merchantId: string;
  name: string;
  version: string;
  currency: "INR";
  capabilities: Record<string, boolean | string>;
  endpoints: Record<string, string>;
};

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

type CheckoutQuote = {
  quoteId: string;
  merchantId: string;
  lineItems: Array<{ productId: string; quantity: number; unitPricePaise: number; lineTotalPaise: number }>;
  subtotalPaise: number;
  shippingPaise: number;
  taxPaise: number;
  discountPaise: number;
  totalPaise: number;
  currency: "INR";
  expiresAt: string;
};

type QuotedProduct = Product & {
  checkoutTotalPaise: number;
  shippingPaise: number;
  taxPaise: number;
  discountPaise: number;
};

async function getCheckoutQuote(productId: string): Promise<CheckoutQuote | null> {
  const response = await fetch(`${merchantInternalUrl}/api/agent/checkout/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productId, quantity: 1 }),
    cache: "no-store",
  });

  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as { quote?: CheckoutQuote } | null;
  return body?.quote ?? null;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { request?: unknown; maxSpendPaise?: unknown } | null;
  const userRequest = typeof body?.request === "string" ? body.request.trim() : "";
  const maxSpendPaise = typeof body?.maxSpendPaise === "number" ? body.maxSpendPaise : NaN;

  if (!userRequest || !Number.isInteger(maxSpendPaise) || maxSpendPaise < 0) return Response.json({ error: "INVALID_BUYER_REQUEST" }, { status: 400 });
  if (!apiKey) return Response.json({ error: "OPENAI_API_KEY_NOT_CONFIGURED" }, { status: 503 });

  const [manifestResponse, catalogResponse] = await Promise.all([
    fetch(`${merchantInternalUrl}/.well-known/agent-commerce`, { cache: "no-store" }),
    fetch(`${merchantInternalUrl}/api/agent/catalog`, { cache: "no-store" }),
  ]);

  if (!manifestResponse.ok || !catalogResponse.ok) return Response.json({ error: "MERCHANT_DISCOVERY_FAILED" }, { status: 502 });

  const manifest = (await manifestResponse.json()) as MerchantManifest;
  const catalogBody = (await catalogResponse.json()) as { products: Product[] };
  const products = catalogBody.products;

  const quoteResults = await Promise.all(products.map(async (product) => ({ product, quote: await getCheckoutQuote(product.id) })));
  const quotedProducts: QuotedProduct[] = quoteResults
    .filter((entry): entry is { product: Product; quote: CheckoutQuote } => Boolean(entry.quote))
    .map(({ product, quote }) => ({
      ...product,
      checkoutTotalPaise: quote.totalPaise,
      shippingPaise: quote.shippingPaise,
      taxPaise: quote.taxPaise,
      discountPaise: quote.discountPaise,
    }));

  if (!quotedProducts.length) return Response.json({ error: "MERCHANT_QUOTE_UNAVAILABLE" }, { status: 502 });

  const withinBudget = quotedProducts.filter((product) => product.inventory > 0 && product.checkoutTotalPaise <= maxSpendPaise);
  const modelProducts = withinBudget.length > 0 ? withinBudget : quotedProducts;

  const response = await fetch(`${openAiBaseUrl}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: [
            "You are the shopping planner inside MANDATE.",
            "You may recommend and rank products, but you never authorize payment, change the user's spending limit, or claim a payment occurred.",
            "Use only product IDs and facts present in the supplied merchant catalog and live checkout quotes.",
            "The hard spending limit is supplied by the application and is immutable for this request.",
            "IMPORTANT: the spending limit applies to the complete checkout total, including tax, shipping and discounts, not just the product price.",
            "Prefer products whose live checkout total is within the hard limit and satisfy explicit requirements.",
            "When qualifying products are supplied, select only from those qualifying products.",
            "If no product qualifies, select the strongest available match so the deterministic policy engine can block it visibly.",
            "Return concise user-facing reasons, not hidden chain-of-thought.",
          ].join(" ") }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: JSON.stringify({
            request: userRequest,
            hardMaxSpendPaise: maxSpendPaise,
            merchant: manifest,
            qualifyingProductsAvailable: withinBudget.length > 0,
            products: modelProducts,
          }) }],
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

  const responseBody = (await response.json().catch(() => null)) as {
    output_text?: string;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    error?: { message?: string };
  } | null;

  if (!response.ok) return Response.json({ error: "MODEL_PLANNING_FAILED", detail: responseBody?.error?.message ?? "The model request failed." }, { status: 502 });

  const modelText =
    typeof responseBody?.output_text === "string" && responseBody.output_text.trim()
      ? responseBody.output_text.trim()
      : (responseBody?.output ?? [])
          .flatMap((item) => item.content ?? [])
          .filter((content) => content.type === "output_text" || content.type === "text")
          .map((content) => content.text)
          .find((text): text is string => typeof text === "string" && Boolean(text.trim()))
          ?.trim() ?? "";

  if (!modelText) return Response.json({ error: "MODEL_PLANNING_FAILED", detail: "The model returned no usable purchase-plan content." }, { status: 502 });

  let plan: {
    category: string;
    requirements: string[];
    rankedProducts: Array<{ productId: string; score: number; rationale: string }>;
    selectedProductId: string;
    decisionSummary: string;
  };

  try {
    plan = JSON.parse(modelText) as typeof plan;
  } catch {
    return Response.json({ error: "MODEL_PLAN_INVALID" }, { status: 502 });
  }

  const validIds = new Set(modelProducts.map((product) => product.id));
  if (!validIds.has(plan.selectedProductId) || plan.rankedProducts.some((item) => !validIds.has(item.productId))) return Response.json({ error: "MODEL_SELECTED_UNKNOWN_PRODUCT" }, { status: 502 });

  const selectedProduct = modelProducts.find((product) => product.id === plan.selectedProductId);
  if (!selectedProduct) return Response.json({ error: "MODEL_SELECTED_UNKNOWN_PRODUCT" }, { status: 502 });

  return Response.json({ plan, selectedProduct, merchantId: manifest.merchantId, model });
}
