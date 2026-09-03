import { createHash } from "node:crypto";
import type { CheckoutLineItem, SignedUserMandate } from "@mandate/types";
import { canonicalizeCheckoutBinding } from "@mandate/types";
import { assertAcpHeaders, getCheckoutSession, type AcpCheckoutSession, type AcpOperationResult, responseHeaders } from "./acp-checkout";

type CompleteRequest = {
  mandate?: unknown;
  user_mandate?: unknown;
  userMandate?: unknown;
};

type GatewayAuthorizationResponse = {
  transaction?: { id?: unknown };
  authorization?: { authorizationId?: unknown; status?: unknown };
};
type GatewayOrderResponse = {
  transaction?: { id?: unknown; state?: unknown; razorpayOrderId?: unknown };
  order?: { id?: unknown; amount?: unknown; currency?: unknown; status?: unknown };
  checkout?: { keyId?: unknown; mode?: unknown };
  mandateAuthorizationId?: unknown;
};
type AcpErrorLike = { status?: unknown; code?: unknown; message?: unknown };
type BridgeResult = AcpOperationResult;

const idempotency = new Map<string, { fingerprint: string; result: BridgeResult; expiresAt: number }>();
const inFlight = new Map<string, string>();

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

function errorResult(status: number, code: string, message: string): BridgeResult {
  return { status, body: { type: "invalid_request", code, message } };
}

function beginIdempotency(key: string, body: unknown): BridgeResult | undefined {
  const bodyFingerprint = fingerprint(body);
  const completed = idempotency.get(key);
  if (completed && completed.expiresAt > Date.now()) {
    if (completed.fingerprint !== bodyFingerprint) return errorResult(422, "idempotency_conflict", "Idempotency-Key has already been used with a different request body.");
    return { ...completed.result, replayed: true };
  }
  idempotency.delete(key);
  const pending = inFlight.get(key);
  if (pending) {
    if (pending !== bodyFingerprint) return errorResult(422, "idempotency_conflict", "Idempotency-Key has already been used with a different request body.");
    return errorResult(409, "idempotency_in_flight", "A request with this Idempotency-Key is currently being processed.");
  }
  inFlight.set(key, bodyFingerprint);
  return undefined;
}

function finishIdempotency(key: string, body: unknown, result: BridgeResult): void {
  idempotency.set(key, { fingerprint: fingerprint(body), result, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
  inFlight.delete(key);
}

function failIdempotency(key: string): void {
  inFlight.delete(key);
}

function extractMandate(body: CompleteRequest): SignedUserMandate | undefined {
  const candidate = body.mandate ?? body.user_mandate ?? body.userMandate;
  if (!candidate || typeof candidate !== "object") return undefined;
  const mandate = candidate as SignedUserMandate;
  return mandate.credential ? mandate : undefined;
}

function totalFromSession(session: AcpCheckoutSession): number {
  const total = session.totals.find((entry) => entry.type === "total");
  if (!total || !Number.isSafeInteger(total.amount) || total.amount < 0) throw new Error("INVALID_CHECKOUT_TOTAL");
  return total.amount;
}

function linesFromSession(session: AcpCheckoutSession): CheckoutLineItem[] {
  return session.line_items.map((line) => ({
    productId: line.item.id,
    quantity: line.quantity,
    unitPricePaise: line.item.unit_amount,
    lineTotalPaise: line.total,
  }));
}

function gatewayBaseUrl(): string {
  return (process.env.GATEWAY_INTERNAL_URL || "http://localhost:4000").replace(/\/$/, "");
}

function gatewaySecret(): string {
  return process.env.INTERNAL_GATEWAY_SECRET?.trim() || "";
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

async function authorizeAtGateway(userMandate: SignedUserMandate, session: AcpCheckoutSession) {
  const lines = linesFromSession(session);
  const checkoutWithoutHash = {
    checkoutId: session.id,
    merchantId: session.metadata.mandate_merchant_id,
    quoteId: session.metadata.mandate_quote_id,
    currency: session.currency,
    totalPaise: totalFromSession(session),
    lineItems: lines,
    expiresAt: session.expires_at,
  } as const;
  const cartHash = createHash("sha256").update(canonicalizeCheckoutBinding(checkoutWithoutHash)).digest("hex");
  if (cartHash !== session.metadata.mandate_cart_hash) {
    return { response: errorResult(409, "mandate_binding_mismatch", "The checkout cart hash no longer matches the merchant-authoritative session."), authorizationId: undefined, transactionId: undefined };
  }

  const response = await fetch(`${gatewayBaseUrl()}/v1/mandates/authorize`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mandate-gateway-secret": gatewaySecret() },
    body: JSON.stringify({
      userMandate,
      checkout: { ...checkoutWithoutHash, cartHash },
      paymentRail: "razorpay_standard_checkout",
    }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    const code = typeof body.error === "string" ? body.error : "mandate_authorization_failed";
    return { response: errorResult(response.status, code.toLowerCase(), code), authorizationId: undefined, transactionId: undefined };
  }

  const result = body as GatewayAuthorizationResponse;
  const transactionId = typeof result.transaction?.id === "string" ? result.transaction.id : "";
  const authorizationId = typeof result.authorization?.authorizationId === "string" ? result.authorization.authorizationId : "";
  if (!transactionId || !authorizationId || result.authorization?.status !== "authorized") {
    return { response: errorResult(502, "invalid_mandate_authorization_response", "Gateway returned an incomplete mandate authorization."), authorizationId: undefined, transactionId: undefined };
  }
  return { response: undefined, authorizationId, transactionId };
}

export async function completeCheckoutSessionWithMandate(id: string, body: unknown, headers: Headers): Promise<BridgeResult> {
  let idempotencyKey = "";
  try {
    idempotencyKey = assertAcpHeaders(headers, true) ?? "";
  } catch (error) {
    const candidate = error as AcpErrorLike;
    if (typeof candidate.status === "number" && typeof candidate.code === "string" && typeof candidate.message === "string") {
      return errorResult(candidate.status, candidate.code, candidate.message);
    }
    return errorResult(400, "invalid_request", "The ACP request headers are invalid.");
  }

  const requestBody = body ?? {};
  const replay = beginIdempotency(idempotencyKey, requestBody);
  if (replay) return replay;

  try {
    const session = getCheckoutSession(id);
    if (session.status === "completed") {
      const result: BridgeResult = { status: 200, session, body: session as unknown as Record<string, unknown>, replayed: false };
      finishIdempotency(idempotencyKey, requestBody, result);
      return result;
    }
    if (session.status === "canceled" || session.status === "expired") {
      const result = errorResult(409, "checkout_session_unavailable", "Checkout session is no longer payable.");
      failIdempotency(idempotencyKey);
      return result;
    }

    if (!gatewaySecret()) {
      const result = errorResult(503, "mandate_gateway_not_configured", "MANDATE gateway credentials are not configured on the merchant server.");
      failIdempotency(idempotencyKey);
      return result;
    }

    const mandate = extractMandate((requestBody || {}) as CompleteRequest);
    if (!mandate) {
      const result = errorResult(409, "mandate_authorization_required", "A signed MANDATE user credential is required before payment completion.");
      failIdempotency(idempotencyKey);
      return result;
    }

    const authorized = await authorizeAtGateway(mandate, session);
    if (authorized.response) {
      failIdempotency(idempotencyKey);
      return authorized.response;
    }

    const transactionId = authorized.transactionId!;
    const authorizationId = authorized.authorizationId!;
    const orderResponse = await fetch(`${gatewayBaseUrl()}/v1/mandates/${encodeURIComponent(authorizationId)}/razorpay-order`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-mandate-gateway-secret": gatewaySecret() },
      body: JSON.stringify({ transactionId }),
    });
    const orderBody = await readJson(orderResponse);
    if (!orderResponse.ok) {
      const code = typeof orderBody.error === "string" ? orderBody.error : "mandate_payment_bridge_failed";
      failIdempotency(idempotencyKey);
      return errorResult(orderResponse.status, code.toLowerCase(), code);
    }

    const payment = orderBody as GatewayOrderResponse;
    const razorpayOrderId = typeof payment.order?.id === "string" ? payment.order.id : typeof payment.transaction?.razorpayOrderId === "string" ? payment.transaction.razorpayOrderId : "";
    if (!razorpayOrderId) {
      failIdempotency(idempotencyKey);
      return errorResult(502, "invalid_payment_order_response", "Gateway returned an incomplete Razorpay order response.");
    }

    const metadata = session.metadata as Record<string, string>;
    metadata.mandate_authorization_id = authorizationId;
    metadata.mandate_transaction_id = transactionId;
    metadata.razorpay_order_id = razorpayOrderId;
    metadata.payment_rail = "razorpay_standard_checkout";
    session.status = "ready_for_payment";
    session.version += 1;

    const bodyOut = {
      ...session,
      mandate: {
        authorization_id: authorizationId,
        transaction_id: transactionId,
        status: "authorized",
        cart_hash: session.metadata.mandate_cart_hash,
      },
      payment: {
        rail: "razorpay_standard_checkout",
        order_id: razorpayOrderId,
        amount: payment.order?.amount ?? totalFromSession(session),
        currency: payment.order?.currency ?? session.currency,
        key_id: typeof payment.checkout?.keyId === "string" ? payment.checkout.keyId : undefined,
        mode: typeof payment.checkout?.mode === "string" ? payment.checkout.mode : "test",
      },
    } as Record<string, unknown>;

    const result: BridgeResult = { status: 200, session, body: bodyOut, replayed: false };
    finishIdempotency(idempotencyKey, requestBody, result);
    return result;
  } catch (error) {
    failIdempotency(idempotencyKey);
    const candidate = error as AcpErrorLike;
    if (typeof candidate.status === "number" && typeof candidate.code === "string" && typeof candidate.message === "string") {
      return errorResult(candidate.status, candidate.code, candidate.message);
    }
    const message = error instanceof Error ? error.message : "Unexpected checkout completion error.";
    return errorResult(500, "internal_error", message);
  }
}

export function mandateBridgeResponseHeaders(headers: Headers, result: BridgeResult): Headers {
  return responseHeaders(headers, result);
}

export function clearMandateBridgeStore(): void {
  idempotency.clear();
  inFlight.clear();
}
