import type {
  AuditEvent,
  CheckoutQuote,
  PolicyCheck,
  PolicyDecision,
  Product,
  PurchaseIntent,
  PurchaseIntentLineItem,
  Transaction,
  TransactionMandateAuthorization,
  TransactionState,
} from "@mandate/types";
import { config } from "./config.js";
import { saveAuditEvent, saveTransaction } from "./persistence.js";

type PurchaseIntentInput = Omit<PurchaseIntent, "id">;
type MerchantSnapshot = {
  products: Product[];
  quote: CheckoutQuote;
  inventories: Record<string, number>;
  product?: Product;
  inventory?: number;
};

const transactions = new Map<string, Transaction>();
const audit = new Map<string, AuditEvent[]>();
const terminalStates = new Set<TransactionState>(["policy_blocked", "payment_failed", "cancelled", "order_confirmed"]);
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

function persist(label: string, operation: () => Promise<void>): void {
  void operation().catch((error) => console.error(`Persistence write failed: ${label}`, error));
}

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
  persist(`audit:${event.id}`, () => saveAuditEvent(event));
  return event;
}

export function addWebhookAudit(id: string, action: string, reason: string, metadata?: AuditEvent["metadata"]): AuditEvent {
  if (!transactions.has(id)) throw new Error("TRANSACTION_NOT_FOUND");
  return addAudit(id, "razorpay", action, reason, metadata);
}

export function addMandateAuthorizationAudit(id: string, metadata: AuditEvent["metadata"]): AuditEvent {
  if (!transactions.has(id)) throw new Error("TRANSACTION_NOT_FOUND");
  return addAudit(
    id,
    "gateway",
    "MANDATE_AUTHORIZED",
    "A user mandate was validated, the checkout binding was revalidated against merchant truth, and payment authorization artifacts were issued.",
    metadata,
  );
}

export function hydrateTransactionStore(seed: { transactions: Transaction[]; auditEvents: AuditEvent[] }): void {
  transactions.clear();
  audit.clear();
  for (const transaction of seed.transactions) transactions.set(transaction.id, transaction);
  for (const event of seed.auditEvents) audit.set(event.transactionId, [...(audit.get(event.transactionId) ?? []), event]);
}

function getIntentLineItems(input: PurchaseIntentInput): PurchaseIntentLineItem[] {
  return input.lineItems?.length ? input.lineItems : [{ productId: input.productId, quantity: input.quantity }];
}

export async function loadMerchantSnapshot(input: PurchaseIntentInput): Promise<MerchantSnapshot> {
  const base = config.merchantInternalUrl.replace(/\/$/, "");
  const requested = getIntentLineItems(input);
  const quoteResponse = await fetch(`${base}/api/agent/checkout/quotes/${encodeURIComponent(input.quoteId)}`);
  if (!quoteResponse.ok) throw new Error("MERCHANT_QUOTE_UNAVAILABLE");
  const quote = ((await quoteResponse.json()) as { quote: CheckoutQuote }).quote;
  const ids = [...new Set(requested.map((item) => item.productId))];
  const products: Product[] = [];
  const inventories: Record<string, number> = {};
  for (const id of ids) {
    const [productResponse, inventoryResponse] = await Promise.all([
      fetch(`${base}/api/agent/products/${encodeURIComponent(id)}`),
      fetch(`${base}/api/agent/inventory/${encodeURIComponent(id)}`),
    ]);
    if (!productResponse.ok) throw new Error("MERCHANT_PRODUCT_UNAVAILABLE");
    if (!inventoryResponse.ok) throw new Error("MERCHANT_INVENTORY_UNAVAILABLE");
    products.push(((await productResponse.json()) as { product: Product }).product);
    inventories[id] = ((await inventoryResponse.json()) as { inventory: number }).inventory;
  }
  const firstProductId = ids[0];
  return {
    products,
    inventories,
    quote,
    product: products[0],
    inventory: firstProductId ? inventories[firstProductId] : undefined,
  };
}

export function evaluatePolicy(input: PurchaseIntentInput, snapshot: MerchantSnapshot): PolicyDecision {
  const checks: PolicyCheck[] = [];
  const requested = getIntentLineItems(input);
  const totalQuantity = requested.reduce((sum, item) => sum + item.quantity, 0);
  const total = snapshot.quote.totalPaise;

  const spendPass = total <= input.maxSpendPaise;
  checks.push({
    rule: "MAX_SPEND",
    result: spendPass ? "PASS" : "FAIL",
    observed: `₹${(total / 100).toFixed(0)}`,
    expected: `≤ ₹${(input.maxSpendPaise / 100).toFixed(0)}`,
    reason: spendPass ? "Combined server quote is within the user's spending limit." : "Combined server quote exceeds the user's spending limit.",
  });

  const quantityPass = totalQuantity <= config.maxQuantity && requested.every((item) => item.quantity <= config.maxQuantity);
  checks.push({
    rule: "QUANTITY_LIMIT",
    result: quantityPass ? "PASS" : "FAIL",
    observed: `${totalQuantity} total units`,
    expected: `≤ ${config.maxQuantity} total units`,
    reason: quantityPass ? "Basket quantities are within the policy limit." : "Basket quantity exceeds the policy limit.",
  });

  const inventoryPass = requested.every((item) => (snapshot.inventories[item.productId] ?? 0) >= item.quantity);
  checks.push({
    rule: "INVENTORY",
    result: inventoryPass ? "PASS" : "FAIL",
    observed: requested.map((item) => `${item.productId}: ${snapshot.inventories[item.productId] ?? 0} available`).join(", "),
    expected: requested.map((item) => `${item.productId}: ${item.quantity} required`).join(", "),
    reason: inventoryPass ? "Inventory can satisfy every requested line." : "At least one basket line does not have enough inventory.",
  });

  const merchantPass = snapshot.quote.merchantId === input.merchantId;
  checks.push({
    rule: "MERCHANT",
    result: merchantPass ? "PASS" : "FAIL",
    observed: snapshot.quote.merchantId,
    expected: input.merchantId,
    reason: merchantPass ? "Quote belongs to the requested merchant." : "Quote merchant does not match the purchase intent.",
  });

  const quotePass = new Date(snapshot.quote.expiresAt).getTime() > Date.now();
  checks.push({
    rule: "QUOTE_VALIDITY",
    result: quotePass ? "PASS" : "FAIL",
    observed: snapshot.quote.expiresAt,
    expected: "expires in the future",
    reason: quotePass ? "Quote is still valid." : "Quote has expired.",
  });

  const productsById = new Map(snapshot.products.map((product) => [product.id, product]));
  const quoted = snapshot.quote.lineItems;
  const quoteMap = new Map(quoted.map((item) => [item.productId, item]));
  const duplicateRequested = new Set(requested.map((item) => item.productId)).size !== requested.length;
  const amountPass =
    !duplicateRequested &&
    requested.length === quoted.length &&
    requested.every((item) => {
      const product = productsById.get(item.productId);
      const line = quoteMap.get(item.productId);
      return Boolean(product && line && line.quantity === item.quantity && line.unitPricePaise === product.pricePaise && line.lineTotalPaise === product.pricePaise * item.quantity);
    });
  checks.push({
    rule: "AMOUNT_INTEGRITY",
    result: amountPass ? "PASS" : "FAIL",
    observed: `${quoted.length} quoted line(s)`,
    expected: `${requested.length} requested line(s) at current merchant prices`,
    reason: amountPass ? "Every server quote line matches the requested basket and current product price." : "The server quote does not exactly match the requested basket or current product prices.",
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
  const transaction: Transaction = {
    id,
    state: "intent_proposed",
    intent: { ...input, id },
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
  persist(`transaction:${id}`, () => saveTransaction(transaction));
  addAudit(id, "ai_buyer", "USER_INTENT_RECEIVED", "The AI buyer proposed a structured purchase intent.", {
    merchantId: input.merchantId,
    productId: input.productId,
    quantity: input.quantity,
    lineItemCount: getIntentLineItems(input).length,
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
    lineItemCount: snapshot.quote.lineItems.length,
  });
  transitionTransaction(id, "policy_pending");
  const policy = evaluatePolicy(input, snapshot);
  transaction.policy = policy;
  persist(`transaction:${id}:policy`, () => saveTransaction(transaction));
  addAudit(
    id,
    "policy_engine",
    policy.decision === "ALLOW" ? "POLICY_ALLOWED" : "POLICY_BLOCKED",
    policy.decision === "ALLOW" ? "All mandatory transaction policies passed." : "At least one mandatory transaction policy failed.",
  );
  transitionTransaction(id, policy.decision === "ALLOW" ? "policy_authorized" : "policy_blocked");
  return transactions.get(id)!;
}

export function attachMandateAuthorization(id: string, authorization: TransactionMandateAuthorization): Transaction {
  const transaction = transactions.get(id);
  if (!transaction) throw new Error("TRANSACTION_NOT_FOUND");
  if (transaction.state !== "policy_authorized") throw new Error("TRANSACTION_NOT_AUTHORIZED");
  if (transaction.mandateAuthorization) {
    if (transaction.mandateAuthorization.authorizationId === authorization.authorizationId) return transaction;
    throw new Error("MANDATE_AUTHORIZATION_ALREADY_BOUND");
  }
  transaction.mandateAuthorization = authorization;
  transaction.updatedAt = new Date().toISOString();
  transactions.set(id, transaction);
  persist(`transaction:${id}:mandate-authorization`, () => saveTransaction(transaction));
  return transaction;
}

export function findTransactionByMandateNonce(mandateId: string, nonce: string): Transaction | undefined {
  return [...transactions.values()].find(
    (transaction) => transaction.mandateAuthorization?.mandateId === mandateId && transaction.mandateAuthorization?.nonce === nonce,
  );
}

export function transitionTransaction(id: string, nextState: TransactionState): Transaction {
  const current = transactions.get(id);
  if (!current) throw new Error("TRANSACTION_NOT_FOUND");
  if (current.state === nextState) return current;
  if (terminalStates.has(current.state)) throw new Error(`INVALID_TRANSITION:${current.state}->${nextState}`);
  const previousState = current.state;
  if (!validTransitions[previousState].includes(nextState)) throw new Error(`INVALID_TRANSITION:${previousState}->${nextState}`);
  current.state = nextState;
  current.updatedAt = new Date().toISOString();
  transactions.set(id, current);
  persist(`transaction:${id}`, () => saveTransaction(current));
  addAudit(id, "gateway", "TRANSACTION_STATE_CHANGED", `Transaction moved from ${previousState} to ${nextState}.`, {
    fromState: previousState,
    state: nextState,
  });
  return current;
}

export function attachRazorpayOrder(id: string, razorpayOrderId: string): Transaction {
  const transaction = getTransaction(id);
  if (!transaction) throw new Error("TRANSACTION_NOT_FOUND");
  if (transaction.state !== "policy_authorized") {
    if (transaction.razorpayOrderId === razorpayOrderId) return transaction;
    throw new Error("TRANSACTION_NOT_AUTHORIZED");
  }
  transaction.razorpayOrderId = razorpayOrderId;
  transactions.set(id, transaction);
  persist(`transaction:${id}:razorpay-order`, () => saveTransaction(transaction));
  transitionTransaction(id, "razorpay_order_created");
  addAudit(id, "gateway", "RAZORPAY_ORDER_CREATED", "A Razorpay Test Mode order was created after policy authorization.", { razorpayOrderId });
  return transaction;
}

export function markCheckoutStarted(id: string): Transaction {
  const transaction = getTransaction(id);
  if (!transaction) throw new Error("TRANSACTION_NOT_FOUND");
  if (transaction.state === "checkout_started") return transaction;
  transitionTransaction(id, "checkout_started");
  addAudit(id, "gateway", "CHECKOUT_STARTED", "The transaction is ready for Razorpay Standard Checkout.");
  return getTransaction(id)!;
}

export function recordPayment(id: string, paymentId: string, status: "authorized" | "captured" | "failed"): Transaction {
  const transaction = getTransaction(id);
  if (!transaction) throw new Error("TRANSACTION_NOT_FOUND");
  const currentState = transaction.state;
  const nonRegressibleStates = new Set<TransactionState>(["payment_captured", "payment_verified", "order_confirmed"]);
  if (status === "failed" && nonRegressibleStates.has(currentState)) {
    addAudit(id, "razorpay", "PAYMENT_FAILED_IGNORED", "A late Razorpay failure event was received after a successful payment state; transaction state was preserved.", {
      razorpayPaymentId: paymentId,
      preservedState: currentState,
    });
    return transaction;
  }
  if (status === "failed" && currentState === "payment_failed") {
    addAudit(id, "razorpay", "PAYMENT_FAILED_DUPLICATE", "Razorpay repeated a failed payment event; transaction state was unchanged.", { razorpayPaymentId: paymentId });
    return transaction;
  }
  transaction.razorpayPaymentId = paymentId;
  transactions.set(id, transaction);
  persist(`transaction:${id}:payment`, () => saveTransaction(transaction));
  if (status === "failed") {
    transitionTransaction(id, "payment_failed");
    addAudit(id, "razorpay", "PAYMENT_FAILED", "Razorpay reported a failed payment.", { razorpayPaymentId: paymentId });
    return getTransaction(id)!;
  }
  if (transaction.state === "checkout_started") transitionTransaction(id, "payment_authorized");
  if (status === "captured" && getTransaction(id)?.state === "payment_authorized") transitionTransaction(id, "payment_captured");
  addAudit(id, "razorpay", status === "captured" ? "PAYMENT_CAPTURED" : "PAYMENT_AUTHORIZED", `Razorpay reported the payment as ${status}.`, { razorpayPaymentId: paymentId });
  return getTransaction(id)!;
}

export function recordPaymentVerified(id: string): Transaction {
  const transaction = getTransaction(id);
  if (!transaction) throw new Error("TRANSACTION_NOT_FOUND");
  if (transaction.state === "payment_verified" || transaction.state === "order_confirmed") return transaction;
  if (transaction.state !== "payment_captured") throw new Error("PAYMENT_NOT_CAPTURED");
  transitionTransaction(id, "payment_verified");
  addAudit(id, "gateway", "PAYMENT_VERIFIED", "Razorpay payment details and checkout signature were verified server-side.", {
    razorpayPaymentId: transaction.razorpayPaymentId ?? null,
  });
  return transaction;
}

export function confirmOrder(id: string): Transaction {
  const transaction = getTransaction(id);
  if (!transaction) throw new Error("TRANSACTION_NOT_FOUND");
  if (transaction.state === "order_confirmed") return transaction;
  if (transaction.state !== "payment_verified") throw new Error("PAYMENT_NOT_VERIFIED");
  transitionTransaction(id, "order_confirmed");
  addAudit(id, "merchant", "ORDER_CONFIRMED", "The merchant order was confirmed only after payment verification.");
  return getTransaction(id)!;
}

export async function retryFailedTransaction(id: string): Promise<Transaction> {
  const transaction = getTransaction(id);
  if (!transaction) throw new Error("TRANSACTION_NOT_FOUND");
  if (transaction.state !== "payment_failed") throw new Error("TRANSACTION_NOT_RETRYABLE");
  addAudit(id, "gateway", "PAYMENT_RETRY_REQUESTED", "A failed payment is being retried as a new transaction so the original failed attempt remains immutable.", {
    retryOfTransactionId: id,
  });
  return proposeTransaction({
    merchantId: transaction.intent.merchantId,
    productId: transaction.intent.productId,
    quantity: transaction.intent.quantity,
    maxSpendPaise: transaction.intent.maxSpendPaise,
    reason: transaction.intent.reason,
    quoteId: transaction.intent.quoteId,
    lineItems: transaction.intent.lineItems,
  });
}

export function getTransaction(id: string): Transaction | undefined {
  return transactions.get(id);
}

export function findTransactionByRazorpayOrderId(orderId: string): Transaction | undefined {
  return [...transactions.values()].find((transaction) => transaction.razorpayOrderId === orderId);
}

export function getTimeline(id: string): AuditEvent[] {
  return audit.get(id) ?? [];
}

export function getAllTransactions(): Transaction[] {
  return [...transactions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
