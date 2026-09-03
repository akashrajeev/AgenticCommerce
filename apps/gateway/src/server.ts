import { createHash } from "node:crypto";
import type { CheckoutLineItem, MoneyAmount } from "@mandate/types";
import { merchantOfferSchema } from "@mandate/schemas";
import { canonicalizeCheckoutBinding } from "@mandate/types";
import { createApp } from "./app.js";
import { authorizeSignedCheckout } from "./mandate-authorization.js";
import { config } from "./config.js";
import { acceptNegotiatedOffer, hydrateNegotiationAcceptancesFromPersistence } from "./negotiation.js";
import {
  createDelegatedMandate,
  getDelegatedMandate,
  delegatedMandateStats,
  executeDelegatedMandate,
  hydrateDelegatedMandatesFromPersistence,
  listDelegatedMandates,
  revokeDelegatedMandate,
  settleDelegatedExecution,
} from "./delegated-mandates.js";
import { initializePersistence } from "./persistence.js";
import { attachRazorpayOrder, getTransaction, hydrateTransactionStore } from "./transaction-core.js";
import { requireTenantPrincipal, type TenantPrincipal } from "./tenant-auth.js";
import { createOrder, getPublicConfig } from "./razorpay.js";

const app = createApp();

app.post("/v1/mandates/authorize", async (request, response) => {
  const providedSecret = request.header("x-mandate-gateway-secret") ?? "";
  if (!providedSecret || providedSecret !== config.internalGatewaySecret) return response.status(401).json({ error: "UNAUTHORIZED_MANDATE_AUTHORIZATION" });
  try {
    const body = request.body as { userMandate?: { credential?: unknown } } | null;
    if (!body || !body.userMandate) return response.status(400).json({ error: "MANDATE_REQUIRED" });
    if (!body.userMandate.credential) return response.status(400).json({ error: "MANDATE_CREDENTIAL_REQUIRED" });
    return response.status(201).json(await authorizeSignedCheckout(request.body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "MANDATE_AUTHORIZATION_FAILED";
    const status = message.startsWith("MANDATE_POLICY_BLOCKED") ? 422 : message.startsWith("INVALID_") || message.includes("_MISMATCH") || message.includes("_EXCEEDED") || message === "MANDATE_EXPIRED" ? 400 : message === "MANDATE_NONCE_REPLAY" ? 409 : 422;
    return response.status(status).json({ error: message });
  }
});

function parseMoney(input: unknown, field: string): MoneyAmount {
  if (!input || typeof input !== "object") throw new Error(`INVALID_${field}`);
  const value = input as Record<string, unknown>;
  const amountPaise = value.amountPaise;
  if (value.currency !== "INR" || typeof amountPaise !== "number" || !Number.isSafeInteger(amountPaise) || amountPaise <= 0) throw new Error(`INVALID_${field}`);
  return { currency: "INR", amountPaise };
}

function parseDelegatedMandateCreate(body: unknown) {
  if (!body || typeof body !== "object") throw new Error("INVALID_DELEGATED_MANDATE_REQUEST");
  const value = body as Record<string, unknown>;
  const list = (entry: unknown, field: string): string[] | undefined => {
    if (entry === undefined) return undefined;
    if (!Array.isArray(entry) || entry.some((item) => typeof item !== "string")) throw new Error(`INVALID_${field}`);
    return entry as string[];
  };
  const constraints = value.constraints;
  if (constraints !== undefined && (!constraints || typeof constraints !== "object" || Array.isArray(constraints))) throw new Error("INVALID_CONSTRAINTS");
  return {
    subjectId: typeof value.subjectId === "string" ? value.subjectId : "",
    agentId: typeof value.agentId === "string" ? value.agentId : "",
    purpose: typeof value.purpose === "string" ? value.purpose : "",
    merchantIds: list(value.merchantIds, "MERCHANT_IDS"),
    allowedProductIds: list(value.allowedProductIds, "ALLOWED_PRODUCT_IDS"),
    maxSpendPerPurchase: parseMoney(value.maxSpendPerPurchase, "MAX_SPEND_PER_PURCHASE"),
    totalBudget: parseMoney(value.totalBudget, "TOTAL_BUDGET"),
    constraints: (constraints ?? {}) as Record<string, string | number | boolean | null>,
    expiresAt: typeof value.expiresAt === "string" ? value.expiresAt : "",
  };
}

function tenantPrincipal(request: import("express").Request): TenantPrincipal | null {
  return requireTenantPrincipal(request.header("authorization") ?? undefined);
}

function enforceMandateOwnership(mandateId: string, principal: TenantPrincipal | null): void {
  if (!principal) return;
  const mandate = getDelegatedMandate(mandateId);
  if (!mandate) throw new Error("DELEGATED_MANDATE_NOT_FOUND");
  if (mandate.subjectId !== principal.subjectId) throw new Error("DELEGATED_MANDATE_FORBIDDEN");
}

function internalSecretOrThrow(request: import("express").Request, error = "UNAUTHORIZED_INTERNAL_REQUEST"): void {
  const provided = request.header("x-mandate-gateway-secret") ?? "";
  if (!provided || provided !== config.internalGatewaySecret) throw new Error(error);
}

function parseCheckoutBinding(body: unknown) {
  if (!body || typeof body !== "object") throw new Error("INVALID_DELEGATED_CHECKOUT");
  const value = body as Record<string, unknown>;
  const lineItems = value.lineItems;
  if (!Array.isArray(lineItems) || lineItems.length < 1 || lineItems.length > 10) throw new Error("INVALID_DELEGATED_CHECKOUT");
  const normalized: CheckoutLineItem[] = lineItems.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("INVALID_DELEGATED_CHECKOUT");
    const line = entry as Record<string, unknown>;
    const productId = line.productId;
    const quantity = line.quantity;
    const unitPricePaise = line.unitPricePaise;
    const lineTotalPaise = line.lineTotalPaise;
    if (typeof productId !== "string" || !productId || typeof quantity !== "number" || !Number.isSafeInteger(quantity) || typeof unitPricePaise !== "number" || !Number.isSafeInteger(unitPricePaise) || typeof lineTotalPaise !== "number" || !Number.isSafeInteger(lineTotalPaise)) throw new Error("INVALID_DELEGATED_CHECKOUT");
    return { productId, quantity, unitPricePaise, lineTotalPaise };
  });
  const checkoutId = typeof value.checkoutId === "string" ? value.checkoutId : "";
  const merchantId = typeof value.merchantId === "string" ? value.merchantId : "";
  const quoteId = typeof value.quoteId === "string" ? value.quoteId : "";
  const currency = value.currency === "INR" ? ("INR" as const) : null;
  const totalPaise = value.totalPaise;
  const expiresAt = typeof value.expiresAt === "string" ? value.expiresAt : "";
  const cartHash = typeof value.cartHash === "string" ? value.cartHash : "";
  if (!checkoutId || !merchantId || !quoteId || currency !== "INR" || typeof totalPaise !== "number" || !Number.isSafeInteger(totalPaise) || !expiresAt || !cartHash) throw new Error("INVALID_DELEGATED_CHECKOUT");
  const checkout = { checkoutId, merchantId, quoteId, currency, totalPaise, lineItems: normalized, expiresAt, cartHash };
  if (createHash("sha256").update(canonicalizeCheckoutBinding(checkout)).digest("hex") !== cartHash) throw new Error("DELEGATED_CHECKOUT_HASH_MISMATCH");
  return checkout;
}

app.post("/v1/delegated-mandates", async (request, response) => {
  try {
    const principal = tenantPrincipal(request);
    const parsed = parseDelegatedMandateCreate(request.body);
    if (principal && parsed.subjectId && parsed.subjectId !== principal.subjectId) return response.status(403).json({ error: "DELEGATED_MANDATE_SUBJECT_MISMATCH" });
    const mandate = await createDelegatedMandate({ ...parsed, ...(principal ? { subjectId: principal.subjectId } : {}) });
    return response.status(201).json({ mandate, remainingPaise: mandate.totalBudget.amountPaise, tenantId: principal?.tenantId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DELEGATED_MANDATE_CREATE_FAILED";
    const status = message.includes("SUBJECT_MISMATCH") || message.includes("FORBIDDEN") ? 403 : message === "TENANT_AUTH_REQUIRED" || message === "INVALID_TENANT_AUTH" ? 401 : message === "TENANT_AUTH_NOT_CONFIGURED" ? 503 : message.startsWith("INVALID_") || message.includes("EXCEEDS") ? 400 : 422;
    return response.status(status).json({ error: message });
  }
});

app.get("/v1/delegated-mandates", (request, response) => {
  try {
    const principal = tenantPrincipal(request);
    return response.json({ tenantId: principal?.tenantId, mandates: listDelegatedMandates(principal?.subjectId).map((mandate) => delegatedMandateStats(mandate.mandateId)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DELEGATED_MANDATE_LIST_FAILED";
    const status = message === "TENANT_AUTH_NOT_CONFIGURED" ? 503 : 401;
    return response.status(status).json({ error: message });
  }
});
app.get("/v1/delegated-mandates/:mandateId", (request, response) => {
  try {
    const principal = tenantPrincipal(request);
    enforceMandateOwnership(request.params.mandateId, principal);
    const mandate = delegatedMandateStats(request.params.mandateId);
    if (!mandate) return response.status(404).json({ error: "DELEGATED_MANDATE_NOT_FOUND" });
    return response.json({ mandate });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DELEGATED_MANDATE_GET_FAILED";
    const status = message === "DELEGATED_MANDATE_NOT_FOUND" ? 404 : message === "DELEGATED_MANDATE_FORBIDDEN" ? 403 : message === "TENANT_AUTH_NOT_CONFIGURED" ? 503 : 401;
    return response.status(status).json({ error: message });
  }
});
app.post("/v1/delegated-mandates/:mandateId/revoke", async (request, response) => {
  try {
    const principal = tenantPrincipal(request);
    enforceMandateOwnership(request.params.mandateId, principal);
    return response.json({ mandate: await revokeDelegatedMandate(request.params.mandateId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DELEGATED_MANDATE_REVOKE_FAILED";
    const status = message === "DELEGATED_MANDATE_NOT_FOUND" ? 404 : message === "DELEGATED_MANDATE_FORBIDDEN" ? 403 : message === "TENANT_AUTH_NOT_CONFIGURED" ? 503 : message === "TENANT_AUTH_REQUIRED" || message === "INVALID_TENANT_AUTH" ? 401 : 409;
    return response.status(status).json({ error: message });
  }
});
app.post("/v1/delegated-mandates/:mandateId/execute", async (request, response) => {
  try {
    const principal = tenantPrincipal(request);
    enforceMandateOwnership(request.params.mandateId, principal);
    const checkout = parseCheckoutBinding(request.body?.checkout ?? request.body);
    const result = await executeDelegatedMandate(request.params.mandateId, checkout);
    let paymentOrder: unknown = null;
    if (config.razorpayKeyId && config.razorpayKeySecret) {
      try {
        const order = await createOrder(result.authorization.transaction);
        const updated = attachRazorpayOrder(result.authorization.transaction.id, order.id);
        paymentOrder = { order, transaction: updated, checkout: getPublicConfig() };
        result.authorization.transaction = updated;
      } catch (error) {
        await settleDelegatedExecution(result.authorization.transaction.id, "released");
        throw error;
      }
    }
    return response.status(201).json({ mode: "delegated_autonomous", mandate: delegatedMandateStats(request.params.mandateId), execution: result.execution, authorization: result.authorization.authorization, transaction: result.authorization.transaction, payment: paymentOrder });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DELEGATED_MANDATE_EXECUTION_FAILED";
    const status = message.includes("NOT_FOUND") ? 404 : message.includes("REMAINING_BUDGET") || message.includes("LIMIT") || message.includes("NOT_ALLOWED") || message.includes("EXPIRED") || message.includes("REVOKED") || message.includes("EXHAUSTED") ? 409 : message.includes("POLICY_BLOCKED") ? 422 : message.includes("RAZORPAY") ? 503 : 400;
    return response.status(status).json({ error: message, mode: "delegated_autonomous" });
  }
});
app.post("/v1/negotiations/:negotiationId/accept", async (request, response) => {
  try {
    const principal = tenantPrincipal(request);
    const mandateId = typeof request.body?.mandateId === "string" ? request.body.mandateId.trim() : "";
    if (mandateId) enforceMandateOwnership(mandateId, principal);
    const parsed = merchantOfferSchema.safeParse(request.body?.offer);
    if (!mandateId) return response.status(400).json({ error: "NEGOTIATION_MANDATE_REQUIRED" });
    if (!parsed.success) return response.status(400).json({ error: "INVALID_NEGOTIATED_OFFER", details: parsed.error.flatten() });
    const result = await acceptNegotiatedOffer({ negotiationId: request.params.negotiationId, mandateId, offer: parsed.data });
    const transaction = getTransaction(result.transactionId);
    if (!transaction) return response.status(500).json({ error: "NEGOTIATION_TRANSACTION_NOT_FOUND" });
    return response.status(result.replayed ? 200 : 201).json({ mode: "negotiated_offer", replayed: result.replayed, offer: result.offer, transaction, authorizationId: result.authorizationId, executionId: result.executionId, mandate: result.mandate });
  } catch (error) {
    const message = error instanceof Error ? error.message : "NEGOTIATION_ACCEPT_FAILED";
    const status = message === "NEGOTIATION_IDEMPOTENCY_CONFLICT" ? 409 : message.includes("NOT_FOUND") ? 404 : message.includes("EXPIRED") || message.includes("MISMATCH") || message.includes("UNSUPPORTED") || message.includes("INVALID") ? 400 : message.includes("LIMIT") || message.includes("NOT_ALLOWED") || message.includes("REVOKED") || message.includes("EXHAUSTED") || message.includes("REMAINING_BUDGET") ? 409 : message.includes("POLICY_BLOCKED") ? 422 : 502;
    return response.status(status).json({ error: message, mode: "negotiated_offer" });
  }
});
app.post("/v1/delegated-mandates/settle/:transactionId", async (request, response) => {
  try {
    internalSecretOrThrow(request, "UNAUTHORIZED_DELEGATED_SETTLEMENT");
    const transaction = getTransaction(request.params.transactionId);
    if (!transaction) return response.status(404).json({ error: "TRANSACTION_NOT_FOUND" });
    const outcome = transaction.state === "order_confirmed" ? "confirmed" : transaction.state === "payment_failed" || transaction.state === "cancelled" ? "released" : null;
    if (!outcome) return response.status(409).json({ error: "TRANSACTION_NOT_SETTLEABLE", state: transaction.state });
    await settleDelegatedExecution(transaction.id, outcome);
    return response.json({ transaction, mandate: transaction.mandateAuthorization ? delegatedMandateStats(transaction.mandateAuthorization.mandateId) : undefined, outcome });
  } catch (error) { return response.status(422).json({ error: error instanceof Error ? error.message : "DELEGATED_MANDATE_SETTLEMENT_FAILED" }); }
});
app.post("/v1/mandates/:authorizationId/razorpay-order", async (request, response) => {
  const providedSecret = request.header("x-mandate-gateway-secret") ?? "";
  if (!providedSecret || providedSecret !== config.internalGatewaySecret) return response.status(401).json({ error: "UNAUTHORIZED_MANDATE_PAYMENT" });
  try {
    const authorizationId = request.params.authorizationId?.trim();
    const transactionId = typeof request.body?.transactionId === "string" ? request.body.transactionId.trim() : "";
    if (!authorizationId || !transactionId) return response.status(400).json({ error: "MANDATE_PAYMENT_BINDING_REQUIRED" });
    const transaction = getTransaction(transactionId);
    if (!transaction) return response.status(404).json({ error: "TRANSACTION_NOT_FOUND" });
    const authorization = transaction.mandateAuthorization;
    if (!authorization || authorization.authorizationId !== authorizationId) return response.status(409).json({ error: "MANDATE_AUTHORIZATION_MISMATCH" });
    if (authorization.status !== "authorized") return response.status(409).json({ error: "MANDATE_AUTHORIZATION_NOT_ACTIVE" });
    if (authorization.paymentRail !== "razorpay_standard_checkout") return response.status(422).json({ error: "UNSUPPORTED_PAYMENT_RAIL" });
    if (new Date(authorization.expiresAt).getTime() <= Date.now()) return response.status(400).json({ error: "MANDATE_AUTHORIZATION_EXPIRED" });
    if (authorization.merchantId !== transaction.quote.merchantId) return response.status(400).json({ error: "MANDATE_MERCHANT_MISMATCH" });
    if (authorization.amount.currency !== transaction.quote.currency || authorization.amount.amountPaise !== transaction.quote.totalPaise) return response.status(400).json({ error: "MANDATE_AMOUNT_MISMATCH" });
    const binding = canonicalizeCheckoutBinding({ checkoutId: authorization.checkoutSessionId, merchantId: transaction.quote.merchantId, quoteId: transaction.quote.quoteId, currency: transaction.quote.currency, totalPaise: transaction.quote.totalPaise, lineItems: transaction.quote.lineItems, expiresAt: transaction.quote.expiresAt });
    const expectedCartHash = createHash("sha256").update(binding).digest("hex");
    if (expectedCartHash !== authorization.cartHash) return response.status(409).json({ error: "MANDATE_BINDING_MISMATCH" });
    if (transaction.razorpayOrderId) return response.json({ transaction, razorpayOrderId: transaction.razorpayOrderId, checkout: getPublicConfig(), mandateAuthorizationId: authorization.authorizationId, alreadyCreated: true });
    if (transaction.state !== "policy_authorized") return response.status(409).json({ error: "TRANSACTION_NOT_AUTHORIZED", state: transaction.state });
    const order = await createOrder(transaction);
    const updated = attachRazorpayOrder(transaction.id, order.id);
    return response.status(201).json({ transaction: updated, order, checkout: getPublicConfig(), mandateAuthorizationId: authorization.authorizationId });
  } catch (error) { const message = error instanceof Error ? error.message : "MANDATE_PAYMENT_BRIDGE_FAILED"; return response.status(message.includes("NOT_CONFIGURED") ? 503 : 422).json({ error: message }); }
});

initializePersistence()
  .then((seed) => {
    hydrateTransactionStore(seed);
    return hydrateDelegatedMandatesFromPersistence();
  })
  .then(() => hydrateNegotiationAcceptancesFromPersistence())
  .then(() => app.listen(config.port, () => console.log(`MANDATE gateway listening on http://localhost:${config.port}`)))
  .catch((error) => { console.error("MANDATE gateway startup failed", error); process.exitCode = 1; });
