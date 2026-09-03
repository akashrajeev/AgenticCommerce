import { createHash } from "node:crypto";
import { canonicalizeCheckoutBinding } from "@mandate/types";
import { createApp } from "./app.js";
import { authorizeSignedCheckout } from "./mandate-authorization.js";
import { config } from "./config.js";
import { attachRazorpayOrder, getTransaction } from "./transaction-core.js";
import { createOrder, getPublicConfig } from "./razorpay.js";

const app = createApp();

app.post("/v1/mandates/authorize", async (request, response) => {
  const providedSecret = request.header("x-mandate-gateway-secret") ?? "";
  if (!providedSecret || providedSecret !== config.internalGatewaySecret) {
    return response.status(401).json({ error: "UNAUTHORIZED_MANDATE_AUTHORIZATION" });
  }
  try {
    const body = request.body as { userMandate?: { credential?: unknown } } | null;
    if (!body || !body.userMandate) return response.status(400).json({ error: "MANDATE_REQUIRED" });
    if (!body.userMandate.credential) return response.status(400).json({ error: "MANDATE_CREDENTIAL_REQUIRED" });
    const result = await authorizeSignedCheckout(request.body);
    return response.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "MANDATE_AUTHORIZATION_FAILED";
    const status =
      message.startsWith("MANDATE_POLICY_BLOCKED")
        ? 422
        : message.startsWith("INVALID_") || message.includes("_MISMATCH") || message.includes("_EXCEEDED") || message === "MANDATE_EXPIRED"
          ? 400
          : message === "MANDATE_NONCE_REPLAY"
            ? 409
            : 422;
    return response.status(status).json({ error: message });
  }
});

app.post("/v1/mandates/:authorizationId/razorpay-order", async (request, response) => {
  const providedSecret = request.header("x-mandate-gateway-secret") ?? "";
  if (!providedSecret || providedSecret !== config.internalGatewaySecret) {
    return response.status(401).json({ error: "UNAUTHORIZED_MANDATE_PAYMENT" });
  }

  try {
    const authorizationId = request.params.authorizationId?.trim();
    const transactionId = typeof request.body?.transactionId === "string" ? request.body.transactionId.trim() : "";
    if (!authorizationId || !transactionId) return response.status(400).json({ error: "MANDATE_PAYMENT_BINDING_REQUIRED" });

    const transaction = getTransaction(transactionId);
    if (!transaction) return response.status(404).json({ error: "TRANSACTION_NOT_FOUND" });

    const authorization = transaction.mandateAuthorization;
    if (!authorization || authorization.authorizationId !== authorizationId) {
      return response.status(409).json({ error: "MANDATE_AUTHORIZATION_MISMATCH" });
    }
    if (authorization.status !== "authorized") return response.status(409).json({ error: "MANDATE_AUTHORIZATION_NOT_ACTIVE" });
    if (authorization.paymentRail !== "razorpay_standard_checkout") return response.status(422).json({ error: "UNSUPPORTED_PAYMENT_RAIL" });
    if (new Date(authorization.expiresAt).getTime() <= Date.now()) return response.status(400).json({ error: "MANDATE_AUTHORIZATION_EXPIRED" });
    if (authorization.merchantId !== transaction.quote.merchantId) return response.status(400).json({ error: "MANDATE_MERCHANT_MISMATCH" });
    if (authorization.amount.currency !== transaction.quote.currency || authorization.amount.amountPaise !== transaction.quote.totalPaise) {
      return response.status(400).json({ error: "MANDATE_AMOUNT_MISMATCH" });
    }

    const binding = canonicalizeCheckoutBinding({
      checkoutId: authorization.checkoutSessionId,
      merchantId: transaction.quote.merchantId,
      quoteId: transaction.quote.quoteId,
      currency: transaction.quote.currency,
      totalPaise: transaction.quote.totalPaise,
      lineItems: transaction.quote.lineItems,
      expiresAt: transaction.quote.expiresAt,
    });
    const expectedCartHash = createHash("sha256").update(binding).digest("hex");
    if (expectedCartHash !== authorization.cartHash) return response.status(409).json({ error: "MANDATE_BINDING_MISMATCH" });

    if (transaction.razorpayOrderId) {
      return response.json({
        transaction,
        razorpayOrderId: transaction.razorpayOrderId,
        checkout: getPublicConfig(),
        mandateAuthorizationId: authorization.authorizationId,
        alreadyCreated: true,
      });
    }
    if (transaction.state !== "policy_authorized") return response.status(409).json({ error: "TRANSACTION_NOT_AUTHORIZED", state: transaction.state });

    const order = await createOrder(transaction);
    const updated = attachRazorpayOrder(transaction.id, order.id);
    return response.status(201).json({
      transaction: updated,
      order,
      checkout: getPublicConfig(),
      mandateAuthorizationId: authorization.authorizationId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MANDATE_PAYMENT_BRIDGE_FAILED";
    return response.status(message.includes("NOT_CONFIGURED") ? 503 : 422).json({ error: message });
  }
});

app.listen(config.port, () => {
  console.log(`MANDATE gateway listening on http://localhost:${config.port}`);
});
