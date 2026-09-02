import type {
  AuditEvent,
  CheckoutQuote,
  PolicyCheck,
  PolicyDecision,
  Product,
  PurchaseIntent,
  Transaction,
  TransactionState,
} from "@mandate/types";
import { config } from "./config.js";

type PurchaseIntentInput = Omit<PurchaseIntent, "id">;

type MerchantSnapshot = {
  product: Product;
  quote: CheckoutQuote;
  inventory: number;
};

const transactions = new Map<string, Transaction>();
const audit = new Map<string, AuditEvent[]>();

const terminalStates = new Set<TransactionState>([
  "policy_blocked",
  "payment_failed",
  "cancelled",
  "order_confirmed",
]);

const validTransitions: Record<TransactionState, TransactionState[]> = {
  intent_proposed: ["price_verified", "policy_blocked"],
  price_verified: ["policy_pending", "policy_blocked"],
  policy_pending: ["policy_authorized", "policy_blocked"],
  policy_authorized: ["razorpay_order_created", "cancelled"],
  policy_blocked: [],
  razorpay_order_created: ["checkout_started", "cancelled"],
  checkout_started: ["payment_authorized", "payment_failed", "cancelled"],
  payment_authorized: ["payment_captured", "payment_failed"],
  payment_captured: ["payment_verified", "payment_failed"],
  payment_verified: ["order_confirmed", "payment_failed"],
  payment_failed: [],
  order_confirmed: [],
  cancelled: [],
};

function addAudit(
  transactionId: string,
  actor: AuditEvent["actor"],
  action: string,
  reason: string,
  metadata?: AuditEvent["metadata"],
): AuditEvent {
  const event: AuditEvent = {
    id: `evt_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
    transactionId,
    actor,
    action,
    reason,
    metadata,
    createdAt: new Date().toISOString(),
  };
  audit.set(transactionId, [...(audit.get(transactionId) ?? []), event]);
  return event;
}

export async function loadMerchantSnapshot(input: PurchaseIntentInput): Promise<MerchantSnapshot> {
  const base = config.merchantAppOrigin.replace(/\/$/, "");
  const [productResponse, inventoryResponse, quoteResponse] = await Promise.all([
    fetch(`${base}/api/agent/products/${encodeURIComponent(input.productId)}`),
    fetch(`${base}/api/agent/inventory/${encodeURIComponent(input.productId)}`),
    fetch(`${base}/api/agent/checkout/quotes/${encodeURIComponent(input.quoteId)}`),
  ]);

  if (!productResponse.ok) throw new Error("MERCHANT_PRODUCT_UNAVAILABLE");
  if (!inventoryResponse.ok) throw new Error("MERCHANT_INVENTORY_UNAVAILABLE");
  if (!quoteResponse.ok) throw new Error("MERCHANT_QUOTE_UNAVAILABLE");

  const productBody = (await productResponse.json()) as { product: Product };
  const inventoryBody = (await inventoryResponse.json()) as { inventory: number };
  const quoteBody = (await quoteResponse.json()) as { quote: CheckoutQuote };

  return {
    product: productBody.product,
    inventory: inventoryBody.inventory,
    quote: quoteBody.quote,
  };
}

export function evaluatePolicy(
  input: PurchaseIntentInput,
  snapshot: MerchantSnapshot,
): PolicyDecision {
  const checks: PolicyCheck[] = [];
  const now = Date.now();
  const quantity = input.quantity;
  const total = snapshot.quote.totalPaise;

  checks.push({
    rule: "MAX_SPEND",
    result: total <= input.maxSpendPaise ? "PASS" : "FAIL",
    observed: `₹${(total / 100).toFixed(0)}`,
    expected: `≤ ₹${(input.maxSpendPaise / 100).toFixed(0)}`,
    reason: total <= input.maxSpendPaise ? "Quote is within the user's spending limit." : "Quote exceeds the user's spending limit.",
  });

  checks.push({
    rule: "QUANTITY_LIMIT",
    result: quantity <= config.maxQuantity ? "PASS" : "FAIL",
    observed: String(quantity),
    expected: `≤ ${config.maxQuantity}`,
    reason: quantity <= config.maxQuantity ? "Requested quantity is within the policy limit." : "Requested quantity exceeds the policy limit.",
  });

  checks.push({
    rule: "INVENTORY",
    result: snapshot.inventory >= quantity ? "PASS" : "FAIL",
    observed: `${snapshot.inventory} available`,
    expected: `${quantity} required`,
    reason: snapshot.inventory >= quantity ? "Inventory can satisfy the request." : "There is not enough inventory to satisfy the request.",
  });

  checks.push({
    rule: "MERCHANT",
    result: snapshot.quote.merchantId === input.merchantId ? "PASS" : "FAIL",
    observed: snapshot.quote.merchantId,
    expected: input.merchantId,
    reason: snapshot.quote.merchantId === input.merchantId ? "Quote belongs to the requested merchant." : "Quote merchant does not match the purchase intent.",
  });

  checks.push({
    rule: "QUOTE_VALIDITY",
    result: new Date(snapshot.quote.expiresAt).getTime() > now ? "PASS" : "FAIL",
    observed: snapshot.quote.expiresAt,
    expected: "expires in the future",
    reason: new Date(snapshot.quote.expiresAt).getTime() > now ? "Quote is still valid." : "Quote has expired.",
  });

  const lineItem = snapshot.quote.lineItems[0];
  const amountMatchesProduct =
    lineItem?.productId === input.productId &&
    lineItem?.quantity === input.quantity &&
    lineItem?.unitPricePaise === snapshot.product.pricePaise;
  checks.push({
    rule: "AMOUNT_INTEGRITY",
    result: amountMatchesProduct ? "PASS" : "FAIL",
    observed: lineItem ? `${lineItem.quantity} × ${lineItem.unitPricePaise}` : "missing line item",
    expected: `${input.quantity} × ${snapshot.product.pricePaise}`,
    reason: amountMatchesProduct ? "Server quote matches the current product price and quantity." : "Quote line item does not match the current product data.",
  });

  return {
    decision: checks.every((check) => check.result === "PASS") ? "ALLOW" : "BLOCK",
    checks,
    evaluatedAt: new Date().toISOString(),
  };
}

export async function proposeTransaction(input: PurchaseIntentInput): Promise<Transaction> {
  const id = `txn_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const now = new Date().toISOString();
  const intent: PurchaseIntent = { ...input, id };
  const transaction: Transaction = {
    id,
    state: "intent_proposed",
    intent,
    quote: {
      quoteId: input.quoteId,
      merchantId: input.merchantId,
      lineItems: [],
      subtotalPaise: 0,
      shippingPaise: 0,
      taxPaise: 0,
      discountPaise: 0,
      totalPaise: 0,
      currency: "INR",
      expiresAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };

  transactions.set(id, transaction);
  addAudit(id, "ai_buyer", "USER_INTENT_RECEIVED", "The AI buyer proposed a structured purchase intent.", {
    merchantId: input.merchantId,
    productId: input.productId,
    quantity: input.quantity,
    maxSpendPaise: input.maxSpendPaise,
  });

  let snapshot: MerchantSnapshot;
  try {
    snapshot = await loadMerchantSnapshot(input);
  } catch (error) {
    transitionTransaction(id, "policy_blocked");
    addAudit(id, "gateway", "MERCHANT_REVALIDATION_FAILED", error instanceof Error ? error.message : "Merchant revalidation failed.");
    return transactions.get(id)!;
  }

  transaction.quote = snapshot.quote;
  transitionTransaction(id, "price_verified");
  addAudit(id, "gateway", "PRICE_VERIFIED", "The gateway re-read the merchant price, inventory and quote before policy evaluation.", {
    totalPaise: snapshot.quote.totalPaise,
  });

  transitionTransaction(id, "policy_pending");
  const policy = evaluatePolicy(input, snapshot);
  transaction.policy = policy;
  addAudit(
    id,
    "policy_engine",
    policy.decision === "ALLOW" ? "POLICY_ALLOWED" : "POLICY_BLOCKED",
    policy.decision === "ALLOW" ? "All mandatory transaction policies passed." : "At least one mandatory transaction policy failed.",
  );

  if (policy.decision === "ALLOW") {
    transitionTransaction(id, "policy_authorized");
  } else {
    transitionTransaction(id, "policy_blocked");
  }

  return transactions.get(id)!;
}

export function transitionTransaction(id: string, nextState: TransactionState): Transaction {
  const current = transactions.get(id);
  if (!current) throw new Error("TRANSACTION_NOT_FOUND");
  if (current.state === nextState) return current;
  if (terminalStates.has(current.state)) throw new Error(`INVALID_TRANSITION:${current.state}->${nextState}`);

  const previousState = current.state;
  const allowed = validTransitions[previousState];
  if (!allowed.includes(nextState)) throw new Error(`INVALID_TRANSITION:${previousState}->${nextState}`);

  current.state = nextState;
  current.updatedAt = new Date().toISOString();
  transactions.set(id, current);
  addAudit(id, "gateway", "TRANSACTION_STATE_CHANGED", `Transaction moved from ${previousState} to ${nextState}.`, {
    fromState: previousState,
    state: nextState,
  });
  return current;
}

export function getTransaction(id: string): Transaction | undefined {
  return transactions.get(id);
}

export function getTimeline(id: string): AuditEvent[] {
  return audit.get(id) ?? [];
}
