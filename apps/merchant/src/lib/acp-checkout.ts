import { createHash } from "node:crypto";
import type { CheckoutQuote } from "@mandate/types";
import { buildMultiLineQuote, findProduct } from "./catalog";

export const ACP_API_VERSION = "2026-04-17";
export const ACP_SESSION_TTL_MS = 5 * 60 * 1000;

type AcpInputLine = { id: string; quantity: number };
type AcpRequest = {
  items?: unknown;
  line_items?: unknown;
  fulfillment_details?: unknown;
  selected_fulfillment_options?: unknown;
};

type AcpTotal = {
  type: string;
  display_text: string;
  amount: number;
};

type AcpLineItem = {
  id: string;
  item: { id: string; name: string; unit_amount: number };
  quantity: number;
  base_amount: number;
  discount: number;
  subtotal: number;
  tax: number;
  total: number;
};

export type AcpCheckoutSession = {
  id: string;
  status: "incomplete" | "ready_for_payment" | "completed" | "canceled" | "expired" | "requires_escalation";
  currency: "INR";
  line_items: AcpLineItem[];
  totals: AcpTotal[];
  fulfillment_options: unknown[];
  messages: unknown[];
  links: unknown[];
  expires_at: string;
  version: number;
  metadata: {
    mandate_merchant_id: string;
    mandate_quote_id: string;
    mandate_cart_hash: string;
    mandate_binding: string;
  };
};

export type AcpOperationResult = {
  status: number;
  session?: AcpCheckoutSession;
  body: Record<string, unknown>;
  replayed?: boolean;
};

class AcpCheckoutError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "AcpCheckoutError";
  }
}

type CompletedIdempotency = {
  fingerprint: string;
  result: AcpOperationResult;
  expiresAt: number;
};

const sessions = new Map<string, AcpCheckoutSession>();
const idempotency = new Map<string, CompletedIdempotency>();
const inFlight = new Map<string, { fingerprint: string }>();

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function errorBody(error: AcpCheckoutError): Record<string, unknown> {
  return { type: "invalid_request", code: error.code, message: error.message };
}

export function assertAcpHeaders(headers: Headers, requireIdempotency: boolean): string | undefined {
  const apiVersion = headers.get("api-version");
  if (apiVersion !== ACP_API_VERSION) {
    throw new AcpCheckoutError(400, "unsupported_api_version", `API-Version ${ACP_API_VERSION} is required.`);
  }

  const configuredKey = process.env.ACP_API_KEY?.trim();
  if (configuredKey) {
    const authorization = headers.get("authorization") ?? "";
    if (authorization !== `Bearer ${configuredKey}`) {
      throw new AcpCheckoutError(401, "authentication_required", "A valid Bearer API key is required.");
    }
  }

  const key = headers.get("idempotency-key")?.trim();
  if (requireIdempotency && !key) {
    throw new AcpCheckoutError(400, "idempotency_key_required", "Idempotency-Key header is required.");
  }
  if (key && key.length > 255) {
    throw new AcpCheckoutError(400, "invalid_idempotency_key", "Idempotency-Key must be at most 255 characters.");
  }
  return key || undefined;
}

function requestId(headers: Headers): string {
  return headers.get("request-id")?.trim() || `req_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function withHeaders(result: AcpOperationResult, headers: Headers): AcpOperationResult {
  return {
    ...result,
    body: result.body,
    replayed: result.replayed,
  };
}

function normalizeLines(body: AcpRequest): AcpInputLine[] {
  const raw = body.items ?? body.line_items;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) {
    throw new AcpCheckoutError(400, "invalid_items", "At least one and at most twenty checkout items are required.");
  }

  const lines = raw.map((entry): AcpInputLine => {
    if (!entry || typeof entry !== "object") {
      throw new AcpCheckoutError(400, "invalid_items", "Each checkout item must be an object.");
    }
    const candidate = entry as Record<string, unknown>;
    const nested = candidate.item && typeof candidate.item === "object" ? candidate.item as Record<string, unknown> : undefined;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : typeof nested?.id === "string" ? nested.id.trim() : "";
    const quantity = typeof candidate.quantity === "number" ? candidate.quantity : NaN;
    if (!id || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) {
      throw new AcpCheckoutError(400, "invalid_items", "Each checkout item requires a valid id and integer quantity from 1 to 10.");
    }
    return { id, quantity };
  });

  return lines;
}

function quoteForLines(lines: AcpInputLine[]): CheckoutQuote {
  try {
    return buildMultiLineQuote(lines.map((line) => ({ productId: line.id, quantity: line.quantity })));
  } catch (error) {
    const message = error instanceof Error ? error.message : "QUOTE_BUILD_FAILED";
    if (message === "PRODUCT_NOT_FOUND") throw new AcpCheckoutError(422, "item_not_found", "One or more requested items do not exist in the merchant catalog.");
    if (message === "INSUFFICIENT_INVENTORY") throw new AcpCheckoutError(422, "insufficient_inventory", "One or more requested items do not have sufficient inventory.");
    throw new AcpCheckoutError(422, "quote_unavailable", "The merchant could not produce an authoritative quote.");
  }
}

function bindingForSession(id: string, quote: CheckoutQuote): string {
  return JSON.stringify({
    checkoutId: id,
    merchantId: quote.merchantId,
    quoteId: quote.quoteId,
    currency: quote.currency,
    totalPaise: quote.totalPaise,
    expiresAt: quote.expiresAt,
    lineItems: [...quote.lineItems]
      .sort((a, b) => a.productId.localeCompare(b.productId))
      .map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        unitPricePaise: line.unitPricePaise,
        lineTotalPaise: line.lineTotalPaise,
      })),
  });
}

function cartHash(id: string, quote: CheckoutQuote): string {
  return createHash("sha256").update(bindingForSession(id, quote)).digest("hex");
}

function toAcpSession(id: string, quote: CheckoutQuote, version: number, status: AcpCheckoutSession["status"] = "ready_for_payment"): AcpCheckoutSession {
  const expiresAt = quote.expiresAt;
  return {
    id,
    status,
    currency: quote.currency,
    line_items: quote.lineItems.map((line, index) => {
      const product = findProduct(line.productId);
      return {
        id: `${id}_line_${index + 1}`,
        item: {
          id: line.productId,
          name: product?.name ?? line.productId,
          unit_amount: line.unitPricePaise,
        },
        quantity: line.quantity,
        base_amount: line.lineTotalPaise,
        discount: 0,
        subtotal: line.lineTotalPaise,
        tax: 0,
        total: line.lineTotalPaise,
      };
    }),
    totals: [
      { type: "items_base_amount", display_text: "Items", amount: quote.subtotalPaise },
      { type: "shipping", display_text: "Shipping", amount: quote.shippingPaise },
      { type: "tax", display_text: "Tax", amount: quote.taxPaise },
      ...(quote.discountPaise > 0 ? [{ type: "discount", display_text: "Discount", amount: quote.discountPaise }] : []),
      { type: "total", display_text: "Total", amount: quote.totalPaise },
    ],
    fulfillment_options: [],
    messages: [],
    links: [],
    expires_at: expiresAt,
    version,
    metadata: {
      mandate_merchant_id: quote.merchantId,
      mandate_quote_id: quote.quoteId,
      mandate_cart_hash: cartHash(id, quote),
      mandate_binding: "merchant_quote_and_cart",
    },
  };
}

function expireSessionIfNeeded(session: AcpCheckoutSession): AcpCheckoutSession {
  if (session.status !== "completed" && session.status !== "canceled" && new Date(session.expires_at).getTime() <= Date.now()) {
    session.status = "expired";
    sessions.set(session.id, session);
  }
  return session;
}

function beginIdempotent(key: string, body: unknown): { fingerprint: string; replay?: AcpOperationResult } {
  const bodyFingerprint = fingerprint(body);
  const completed = idempotency.get(key);
  if (completed && completed.expiresAt > Date.now()) {
    if (completed.fingerprint !== bodyFingerprint) {
      throw new AcpCheckoutError(422, "idempotency_conflict", "Idempotency-Key has already been used with a different request body.");
    }
    return { fingerprint: bodyFingerprint, replay: { ...completed.result, replayed: true, body: completed.result.body } };
  }
  idempotency.delete(key);
  const pending = inFlight.get(key);
  if (pending) {
    if (pending.fingerprint !== bodyFingerprint) {
      throw new AcpCheckoutError(422, "idempotency_conflict", "Idempotency-Key has already been used with a different request body.");
    }
    throw new AcpCheckoutError(409, "idempotency_in_flight", "A request with this Idempotency-Key is currently being processed.");
  }
  inFlight.set(key, { fingerprint: bodyFingerprint });
  return { fingerprint: bodyFingerprint };
}

function finishIdempotent(key: string | undefined, body: unknown, result: AcpOperationResult, ttlMs = 24 * 60 * 60 * 1000): void {
  if (!key) return;
  const bodyFingerprint = fingerprint(body);
  idempotency.set(key, { fingerprint: bodyFingerprint, result, expiresAt: Date.now() + ttlMs });
  inFlight.delete(key);
}

function failIdempotent(key: string | undefined): void {
  if (key) inFlight.delete(key);
}

export function createCheckoutSession(body: unknown, headers: Headers): AcpOperationResult {
  const idempotencyKey = assertAcpHeaders(headers, true);
  const requestBody = body as AcpRequest;
  try {
    if (!requestBody || typeof requestBody !== "object") throw new AcpCheckoutError(400, "invalid_request", "A checkout request body is required.");
    const idempotencyState = beginIdempotent(idempotencyKey!, requestBody);
    if (idempotencyState.replay) return withHeaders(idempotencyState.replay, headers);

    const lines = normalizeLines(requestBody);
    const quote = quoteForLines(lines);
    const id = `cs_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const session = toAcpSession(id, quote, 1);
    sessions.set(id, session);
    const result: AcpOperationResult = {
      status: 201,
      session,
      body: session as unknown as Record<string, unknown>,
      replayed: false,
    };
    finishIdempotent(idempotencyKey, requestBody, result);
    return withHeaders(result, headers);
  } catch (error) {
    failIdempotent(idempotencyKey);
    if (error instanceof AcpCheckoutError) throw error;
    throw new AcpCheckoutError(500, "checkout_session_create_failed", "Unable to create the checkout session.");
  }
}

export function getCheckoutSession(id: string): AcpCheckoutSession {
  const session = sessions.get(id);
  if (!session) throw new AcpCheckoutError(404, "checkout_session_not_found", "Checkout session not found.");
  return expireSessionIfNeeded(session);
}

export function updateCheckoutSession(id: string, body: unknown, headers: Headers): AcpOperationResult {
  const idempotencyKey = assertAcpHeaders(headers, true);
  const requestBody = body as AcpRequest;
  try {
    const current = getCheckoutSession(id);
    if (current.status === "completed" || current.status === "canceled" || current.status === "expired") {
      throw new AcpCheckoutError(409, "checkout_session_not_mutable", "This checkout session cannot be updated in its current state.");
    }
    const idempotencyState = beginIdempotent(idempotencyKey!, requestBody);
    if (idempotencyState.replay) return withHeaders(idempotencyState.replay, headers);

    if (!requestBody || typeof requestBody !== "object") throw new AcpCheckoutError(400, "invalid_request", "An update body is required.");
    const hasItems = "items" in requestBody || "line_items" in requestBody;
    if (!hasItems) throw new AcpCheckoutError(400, "unsupported_update", "This Phase 3 adapter currently updates checkout items; send items or line_items.");
    const lines = normalizeLines(requestBody);
    const quote = quoteForLines(lines);
    const next = toAcpSession(id, quote, current.version + 1);
    sessions.set(id, next);
    const result: AcpOperationResult = { status: 200, session: next, body: next as unknown as Record<string, unknown>, replayed: false };
    finishIdempotent(idempotencyKey, requestBody, result);
    return withHeaders(result, headers);
  } catch (error) {
    failIdempotent(idempotencyKey);
    throw error instanceof AcpCheckoutError ? error : new AcpCheckoutError(500, "checkout_session_update_failed", "Unable to update the checkout session.");
  }
}

export function cancelCheckoutSession(id: string, body: unknown, headers: Headers): AcpOperationResult {
  const idempotencyKey = assertAcpHeaders(headers, true);
  const requestBody = body ?? {};
  try {
    const current = getCheckoutSession(id);
    const idempotencyState = beginIdempotent(idempotencyKey!, requestBody);
    if (idempotencyState.replay) return withHeaders(idempotencyState.replay, headers);
    if (current.status === "completed" || current.status === "canceled") {
      throw new AcpCheckoutError(405, "checkout_session_not_cancelable", "Checkout session is already completed or canceled.");
    }
    current.status = "canceled";
    current.version += 1;
    sessions.set(id, current);
    const result: AcpOperationResult = { status: 200, session: current, body: current as unknown as Record<string, unknown>, replayed: false };
    finishIdempotent(idempotencyKey, requestBody, result);
    return withHeaders(result, headers);
  } catch (error) {
    failIdempotent(idempotencyKey);
    throw error instanceof AcpCheckoutError ? error : new AcpCheckoutError(500, "checkout_session_cancel_failed", "Unable to cancel the checkout session.");
  }
}

export function completeCheckoutSession(id: string, body: unknown, headers: Headers): AcpOperationResult {
  const idempotencyKey = assertAcpHeaders(headers, true);
  const requestBody = body ?? {};
  try {
    const current = getCheckoutSession(id);
    const idempotencyState = beginIdempotent(idempotencyKey!, requestBody);
    if (idempotencyState.replay) return withHeaders(idempotencyState.replay, headers);
    if (current.status === "completed") {
      const result: AcpOperationResult = { status: 200, session: current, body: current as unknown as Record<string, unknown>, replayed: false };
      finishIdempotent(idempotencyKey, requestBody, result);
      return withHeaders(result, headers);
    }
    if (current.status === "canceled" || current.status === "expired") throw new AcpCheckoutError(409, "checkout_session_unavailable", "Checkout session is no longer payable.");

    const mandateTransactionId = headers.get("x-mandate-transaction-id")?.trim();
    if (!mandateTransactionId) {
      current.status = "requires_escalation";
      sessions.set(id, current);
      throw new AcpCheckoutError(409, "mandate_authorization_required", "MANDATE must authorize and bind this checkout before payment completion.");
    }

    throw new AcpCheckoutError(501, "mandate_payment_bridge_pending", "The ACP completion surface is wired to the MANDATE boundary; the Razorpay payment bridge is implemented in the next mandate phase.");
  } catch (error) {
    failIdempotent(idempotencyKey);
    throw error instanceof AcpCheckoutError ? error : new AcpCheckoutError(500, "checkout_session_complete_failed", "Unable to complete the checkout session.");
  }
}

export function formatAcpError(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof AcpCheckoutError) return { status: error.status, body: errorBody(error) };
  return { status: 500, body: { type: "server_error", code: "internal_error", message: "Unexpected checkout error." } };
}

export function sessionStoreSize(): number {
  return sessions.size;
}

export function clearAcpCheckoutStore(): void {
  sessions.clear();
  idempotency.clear();
  inFlight.clear();
}

export function responseHeaders(headers: Headers, result: AcpOperationResult): Headers {
  const response = new Headers();
  response.set("content-type", "application/json");
  response.set("api-version", ACP_API_VERSION);
  response.set("request-id", requestId(headers));
  const idempotencyKey = headers.get("idempotency-key");
  if (idempotencyKey) response.set("idempotency-key", idempotencyKey);
  if (result.replayed) response.set("idempotent-replayed", "true");
  return response;
}
