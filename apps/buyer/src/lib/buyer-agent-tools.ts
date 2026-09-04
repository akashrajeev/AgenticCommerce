import type { BuyerAgentRun } from "./buyer-agent";
import { assertBuyerBudget } from "./buyer-agent";

export const BUYER_AGENT_TOOL_NAMES = [
  "discover_merchant",
  "read_catalog",
  "search_products",
  "inspect_product",
  "check_inventory",
  "get_quote",
  "compare_products",
  "get_merchant_recommendations",
  "build_basket",
  "validate_budget",
  "prepare_approval",
] as const;

export type BuyerAgentToolName = (typeof BUYER_AGENT_TOOL_NAMES)[number];

export type BuyerProduct = {
  id: string;
  name: string;
  category: string;
  pricePaise: number;
  rating: number;
  inventory: number;
  features: string[];
  specifications: Record<string, string>;
};

export type BuyerMerchantManifest = {
  merchantId: string;
  name: string;
  version: string;
  currency: "INR";
  capabilities: Record<string, boolean | string>;
  endpoints: Record<string, string>;
};

export type BuyerQuote = {
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

export type BuyerRecommendation = {
  productId: string;
  type: "UPSELL" | "CROSS_SELL";
  score: number;
  rationale: string;
  incrementalRevenuePaise: number;
};

export type BuyerBasketLine = { productId: string; quantity: number };

export type BuyerAgentWorkspace = {
  manifest?: BuyerMerchantManifest;
  catalog?: BuyerProduct[];
  inspectedProducts: Record<string, BuyerProduct>;
  inventory: Record<string, number>;
  recommendations: BuyerRecommendation[];
  selectedProductId?: string;
  basket: BuyerBasketLine[];
  latestQuote?: BuyerQuote;
};

export type BuyerAgentToolContext = {
  run: BuyerAgentRun;
  workspace: BuyerAgentWorkspace;
  merchantInternalUrl?: string;
};

export type BuyerAgentToolResult = {
  tool: BuyerAgentToolName;
  result: unknown;
};

const TOOL_DESCRIPTIONS: Record<BuyerAgentToolName, string> = {
  discover_merchant: "Read the merchant's machine-readable agent manifest and capabilities.",
  read_catalog: "Read the merchant catalog without scraping the storefront.",
  search_products: "Filter the observed catalog using the buyer's objective and immutable budget.",
  inspect_product: "Read the current details for one product from the merchant agent endpoint.",
  check_inventory: "Read the current inventory for one product before relying on it.",
  get_quote: "Request a fresh merchant checkout quote for the proposed basket. This does not authorize payment.",
  compare_products: "Return normalized facts for several observed or inspected products so the planner can compare them.",
  get_merchant_recommendations: "Read merchant-published upsell/cross-sell recommendations for the selected product.",
  build_basket: "Set a proposed buyer basket and obtain a fresh merchant quote, subject to the immutable spend limit.",
  validate_budget: "Deterministically verify a proposed total against the application's immutable buyer limit.",
  prepare_approval: "Freeze the current proposed basket and quote into a review-ready recommendation. It never authorizes payment.",
};

export const BUYER_AGENT_TOOL_DESCRIPTIONS = TOOL_DESCRIPTIONS;

export const BUYER_AGENT_TOOLS = BUYER_AGENT_TOOL_NAMES.map((name) => ({
  type: "function" as const,
  name,
  description: TOOL_DESCRIPTIONS[name],
  strict: true,
  parameters: toolParameters(name),
}));

function toolParameters(name: BuyerAgentToolName) {
  const commonQuantity = {
    type: "integer",
    minimum: 1,
    maximum: 10,
  } as const;

  switch (name) {
    case "discover_merchant":
    case "read_catalog":
      return { type: "object", additionalProperties: false, properties: {} } as const;
    case "search_products":
      return {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", maxLength: 120 },
          category: { type: "string", maxLength: 80 },
          maxPricePaise: { type: "integer", minimum: 0 },
          inStockOnly: { type: "boolean" },
        },
        required: [],
      } as const;
    case "inspect_product":
    case "check_inventory":
      return {
        type: "object",
        additionalProperties: false,
        properties: { productId: { type: "string", minLength: 1, maxLength: 100 } },
        required: ["productId"],
      } as const;
    case "get_quote":
      return {
        type: "object",
        additionalProperties: false,
        properties: {
          lineItems: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                productId: { type: "string", minLength: 1, maxLength: 100 },
                quantity: commonQuantity,
              },
              required: ["productId", "quantity"],
            },
          },
        },
        required: ["lineItems"],
      } as const;
    case "compare_products":
      return {
        type: "object",
        additionalProperties: false,
        properties: {
          productIds: { type: "array", minItems: 2, maxItems: 5, items: { type: "string", minLength: 1, maxLength: 100 } },
        },
        required: ["productIds"],
      } as const;
    case "get_merchant_recommendations":
      return {
        type: "object",
        additionalProperties: false,
        properties: {
          productId: { type: "string", minLength: 1, maxLength: 100 },
        },
        required: ["productId"],
      } as const;
    case "build_basket":
      return {
        type: "object",
        additionalProperties: false,
        properties: {
          lineItems: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                productId: { type: "string", minLength: 1, maxLength: 100 },
                quantity: commonQuantity,
              },
              required: ["productId", "quantity"],
            },
          },
        },
        required: ["lineItems"],
      } as const;
    case "validate_budget":
      return {
        type: "object",
        additionalProperties: false,
        properties: { totalPaise: { type: "integer", minimum: 0 } },
        required: ["totalPaise"],
      } as const;
    case "prepare_approval":
      return { type: "object", additionalProperties: false, properties: {} } as const;
  }
}

function merchantUrl(context: BuyerAgentToolContext): string {
  return (context.merchantInternalUrl ?? process.env.MERCHANT_INTERNAL_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function requireString(value: unknown, errorCode: string): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) throw new Error(errorCode);
  return result;
}

function requireLineItems(value: unknown): BuyerBasketLine[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) throw new Error("BUYER_AGENT_LINE_ITEMS_INVALID");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("BUYER_AGENT_LINE_ITEMS_INVALID");
    const item = entry as Record<string, unknown>;
    const productId = requireString(item.productId, "BUYER_AGENT_LINE_ITEMS_INVALID");
    const quantity = item.quantity;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) throw new Error("BUYER_AGENT_LINE_ITEMS_INVALID");
    return { productId, quantity };
  });
}

async function merchantFetch<T>(context: BuyerAgentToolContext, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${merchantUrl(context)}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json().catch(() => null) as T | { error?: string } | null;
  if (!response.ok) {
    const detail = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : `HTTP_${response.status}`;
    throw new Error(`BUYER_AGENT_MERCHANT_${detail}`);
  }
  return body as T;
}

function ensureCatalog(context: BuyerAgentToolContext): BuyerProduct[] {
  if (!context.workspace.catalog) throw new Error("BUYER_AGENT_CATALOG_NOT_LOADED");
  return context.workspace.catalog;
}

function normalizeText(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

async function discoverMerchant(context: BuyerAgentToolContext): Promise<BuyerMerchantManifest> {
  const body = await merchantFetch<{ merchantId?: string; name?: string; version?: string; currency?: "INR"; capabilities?: Record<string, boolean | string>; endpoints?: Record<string, string> }>(context, "/.well-known/agent-commerce");
  if (!body?.merchantId || !body.name || !body.version || body.currency !== "INR" || !body.endpoints) throw new Error("BUYER_AGENT_MANIFEST_INVALID");
  const manifest: BuyerMerchantManifest = {
    merchantId: body.merchantId,
    name: body.name,
    version: body.version,
    currency: "INR",
    capabilities: body.capabilities ?? {},
    endpoints: body.endpoints,
  };
  context.workspace.manifest = manifest;
  return manifest;
}

async function readCatalog(context: BuyerAgentToolContext): Promise<BuyerProduct[]> {
  const body = await merchantFetch<{ products?: BuyerProduct[] }>(context, "/api/agent/catalog");
  if (!Array.isArray(body?.products)) throw new Error("BUYER_AGENT_CATALOG_INVALID");
  context.workspace.catalog = body.products;
  return body.products;
}

function searchProducts(context: BuyerAgentToolContext, args: Record<string, unknown>): unknown {
  const catalog = ensureCatalog(context);
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const category = typeof args.category === "string" ? args.category.trim().toLowerCase() : "";
  const maxPricePaise = args.maxPricePaise === undefined ? context.run.constraints.maxSpendPaise : args.maxPricePaise;
  const inStockOnly = args.inStockOnly === undefined ? true : args.inStockOnly;
  if (!Number.isSafeInteger(maxPricePaise) || maxPricePaise < 0) throw new Error("BUYER_AGENT_SEARCH_BUDGET_INVALID");
  const queryTokens = normalizeText(query);
  const results = catalog.filter((product) => {
    if (category && product.category.toLowerCase() !== category) return false;
    if (product.pricePaise > Math.min(maxPricePaise, context.run.constraints.maxSpendPaise)) return false;
    if (inStockOnly && product.inventory < 1) return false;
    if (!context.run.constraints.requiredProductIds?.length && !context.run.constraints.requiredCategory && !queryTokens.length) return true;
    if (context.run.constraints.requiredProductIds?.length && !context.run.constraints.requiredProductIds.includes(product.id)) return false;
    if (context.run.constraints.requiredCategory && product.category.toLowerCase() !== context.run.constraints.requiredCategory.toLowerCase()) return false;
    if (!queryTokens.length) return true;
    const haystack = [product.name, product.category, ...product.features, ...Object.entries(product.specifications).flat()].join(" ").toLowerCase();
    return queryTokens.every((token) => haystack.includes(token));
  }).slice(0, 20);
  return { count: results.length, products: results };
}

async function inspectProduct(context: BuyerAgentToolContext, args: Record<string, unknown>): Promise<BuyerProduct> {
  const productId = requireString(args.productId, "BUYER_AGENT_PRODUCT_ID_REQUIRED");
  const body = await merchantFetch<{ product?: BuyerProduct }>(context, `/api/agent/products/${encodeURIComponent(productId)}`);
  if (!body?.product) throw new Error("BUYER_AGENT_PRODUCT_NOT_FOUND");
  context.workspace.inspectedProducts[body.product.id] = body.product;
  return body.product;
}

async function checkInventory(context: BuyerAgentToolContext, args: Record<string, unknown>): Promise<{ productId: string; inventory: number }> {
  const productId = requireString(args.productId, "BUYER_AGENT_PRODUCT_ID_REQUIRED");
  const body = await merchantFetch<{ inventory?: number }>(context, `/api/agent/inventory/${encodeURIComponent(productId)}`);
  if (!Number.isSafeInteger(body?.inventory) || (body?.inventory ?? -1) < 0) throw new Error("BUYER_AGENT_INVENTORY_INVALID");
  context.workspace.inventory[productId] = body.inventory;
  return { productId, inventory: body.inventory };
}

async function getQuote(context: BuyerAgentToolContext, args: Record<string, unknown>): Promise<BuyerQuote> {
  const lineItems = requireLineItems(args.lineItems);
  const body = await merchantFetch<{ quote?: BuyerQuote }>(context, "/api/agent/checkout/preview", {
    method: "POST",
    body: JSON.stringify({ lineItems }),
  });
  if (!body?.quote || body.quote.currency !== "INR") throw new Error("BUYER_AGENT_QUOTE_INVALID");
  assertBuyerBudget(context.run, body.quote.totalPaise);
  context.workspace.latestQuote = body.quote;
  return body.quote;
}

function compareProducts(context: BuyerAgentToolContext, args: Record<string, unknown>): unknown {
  const productIds = Array.isArray(args.productIds) ? args.productIds.map((value) => requireString(value, "BUYER_AGENT_PRODUCT_ID_REQUIRED")) : [];
  if (productIds.length < 2 || productIds.length > 5) throw new Error("BUYER_AGENT_COMPARE_PRODUCTS_INVALID");
  const products = productIds.map((id) => context.workspace.inspectedProducts[id] ?? context.workspace.catalog?.find((product) => product.id === id)).filter((product): product is BuyerProduct => Boolean(product));
  if (products.length !== productIds.length) throw new Error("BUYER_AGENT_COMPARE_PRODUCT_NOT_OBSERVED");
  return {
    products: products.map((product) => ({
      productId: product.id,
      name: product.name,
      category: product.category,
      pricePaise: product.pricePaise,
      rating: product.rating,
      inventory: product.inventory,
      features: product.features,
      specifications: product.specifications,
    })),
  };
}

async function getMerchantRecommendations(context: BuyerAgentToolContext, args: Record<string, unknown>): Promise<BuyerRecommendation[]> {
  const productId = requireString(args.productId, "BUYER_AGENT_PRODUCT_ID_REQUIRED");
  if (productId !== context.workspace.selectedProductId) context.workspace.selectedProductId = productId;
  const body = await merchantFetch<{ recommendations?: BuyerRecommendation[] }>(context, `/api/agent/recommendations?productId=${encodeURIComponent(productId)}&maxSpendPaise=${context.run.constraints.maxSpendPaise}`);
  if (!Array.isArray(body?.recommendations)) throw new Error("BUYER_AGENT_RECOMMENDATIONS_INVALID");
  context.workspace.recommendations = body.recommendations;
  return body.recommendations;
}

async function buildBasket(context: BuyerAgentToolContext, args: Record<string, unknown>): Promise<{ basket: BuyerBasketLine[]; quote: BuyerQuote }> {
  const lineItems = requireLineItems(args.lineItems);
  const productIds = new Set(lineItems.map((line) => line.productId));
  for (const requiredId of context.run.constraints.requiredProductIds ?? []) {
    if (!productIds.has(requiredId)) throw new Error("BUYER_AGENT_REQUIRED_PRODUCT_MISSING");
  }
  for (const line of lineItems) {
    const observed = context.workspace.inspectedProducts[line.productId] ?? context.workspace.catalog?.find((product) => product.id === line.productId);
    if (!observed) throw new Error("BUYER_AGENT_BASKET_PRODUCT_NOT_OBSERVED");
    const inventory = context.workspace.inventory[line.productId] ?? observed.inventory;
    if (inventory < line.quantity) throw new Error("BUYER_AGENT_INVENTORY_INSUFFICIENT");
  }
  const quote = await getQuote(context, { lineItems });
  context.workspace.basket = lineItems;
  context.workspace.selectedProductId = lineItems[0]?.productId;
  return { basket: lineItems, quote };
}

function validateBudget(context: BuyerAgentToolContext, args: Record<string, unknown>): { totalPaise: number; maxSpendPaise: number; withinBudget: true } {
  const totalPaise = args.totalPaise;
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 0) throw new Error("BUYER_AGENT_TOTAL_INVALID");
  assertBuyerBudget(context.run, totalPaise);
  return { totalPaise, maxSpendPaise: context.run.constraints.maxSpendPaise, withinBudget: true };
}

function prepareApproval(context: BuyerAgentToolContext): unknown {
  if (!context.workspace.basket.length) throw new Error("BUYER_AGENT_BASKET_NOT_READY");
  if (!context.workspace.latestQuote) throw new Error("BUYER_AGENT_QUOTE_NOT_READY");
  assertBuyerBudget(context.run, context.workspace.latestQuote.totalPaise);
  return {
    status: "READY_FOR_APPROVAL",
    merchantId: context.workspace.latestQuote.merchantId,
    quoteId: context.workspace.latestQuote.quoteId,
    lineItems: context.workspace.latestQuote.lineItems,
    totalPaise: context.workspace.latestQuote.totalPaise,
    currency: context.workspace.latestQuote.currency,
    expiresAt: context.workspace.latestQuote.expiresAt,
    reason: "Buyer Agent prepared this basket for explicit user review. No payment was authorized.",
  };
}

export function createBuyerAgentWorkspace(): BuyerAgentWorkspace {
  return {
    inspectedProducts: {},
    inventory: {},
    recommendations: [],
    basket: [],
  };
}

export function assertBuyerAgentToolName(name: string): asserts name is BuyerAgentToolName {
  if (!(BUYER_AGENT_TOOL_NAMES as readonly string[]).includes(name)) throw new Error("BUYER_AGENT_TOOL_NOT_ALLOWED");
}

export function parseBuyerAgentToolArguments(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("BUYER_AGENT_TOOL_ARGUMENTS_INVALID");
  return value as Record<string, unknown>;
}

export async function executeBuyerAgentTool(
  context: BuyerAgentToolContext,
  name: string,
  rawArguments: unknown = {},
): Promise<BuyerAgentToolResult> {
  assertBuyerAgentToolName(name);
  const args = parseBuyerAgentToolArguments(rawArguments);
  let result: unknown;
  switch (name) {
    case "discover_merchant":
      result = await discoverMerchant(context);
      break;
    case "read_catalog":
      result = await readCatalog(context);
      break;
    case "search_products":
      result = searchProducts(context, args);
      break;
    case "inspect_product":
      result = await inspectProduct(context, args);
      break;
    case "check_inventory":
      result = await checkInventory(context, args);
      break;
    case "get_quote":
      result = await getQuote(context, args);
      break;
    case "compare_products":
      result = compareProducts(context, args);
      break;
    case "get_merchant_recommendations":
      result = await getMerchantRecommendations(context, args);
      break;
    case "build_basket":
      result = await buildBasket(context, args);
      break;
    case "validate_budget":
      result = validateBudget(context, args);
      break;
    case "prepare_approval":
      result = prepareApproval(context);
      break;
  }
  return { tool: name, result };
}
