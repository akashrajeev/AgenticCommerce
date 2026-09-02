import { createHash } from "node:crypto";
import type { PurchaseIntent, Transaction } from "@mandate/types";
import { createHealthStatus } from "@mandate/shared";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "./config.js";
import {
  attachRazorpayOrder,
  confirmOrder,
  findTransactionByRazorpayOrderId,
  getAllTransactions,
  getTimeline,
  getTransaction,
  markCheckoutStarted,
  proposeTransaction,
  recordPayment,
  recordPaymentVerified,
} from "./transaction-core.js";
import {
  capturePayment,
  createOrder,
  fetchOrderPayments,
  fetchPayment,
  getPublicConfig,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "./razorpay.js";

const processedWebhookKeys = new Set<string>();

function parsePurchaseIntent(body: unknown): Omit<PurchaseIntent, "id"> {
  if (!body || typeof body !== "object") throw new Error("INVALID_REQUEST");
  const input = body as Record<string, unknown>;

  const merchantId = typeof input.merchantId === "string" ? input.merchantId : "";
  const productId = typeof input.productId === "string" ? input.productId : "";
  const quoteId = typeof input.quoteId === "string" ? input.quoteId : "";
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const quantity = typeof input.quantity === "number" ? input.quantity : NaN;
  const maxSpendPaise = typeof input.maxSpendPaise === "number" ? input.maxSpendPaise : NaN;

  if (!merchantId || !productId || !quoteId || !reason) throw new Error("INVALID_REQUEST");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > config.maxQuantity) throw new Error("INVALID_QUANTITY");
  if (!Number.isInteger(maxSpendPaise) || maxSpendPaise < 0) throw new Error("INVALID_SPEND_LIMIT");

  return { merchantId, productId, quoteId, reason, quantity, maxSpendPaise };
}

function getTransactionOrThrow(id: string): Transaction {
  const transaction = getTransaction(id);
  if (!transaction) throw new Error("TRANSACTION_NOT_FOUND");
  return transaction;
}

async function confirmMerchantOrder(transaction: Transaction) {
  if (!transaction.razorpayOrderId || !transaction.razorpayPaymentId) throw new Error("PAYMENT_REFERENCE_INCOMPLETE");
  const base = config.merchantAppOrigin.replace(/\/$/, "");
  const response = await fetch(`${base}/api/agent/orders/confirm`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mandate-gateway-secret": config.internalGatewaySecret,
    },
    body: JSON.stringify({
      transactionId: transaction.id,
      productId: transaction.intent.productId,
      quantity: transaction.intent.quantity,
      amountPaise: transaction.quote.totalPaise,
      razorpayOrderId: transaction.razorpayOrderId,
      razorpayPaymentId: transaction.razorpayPaymentId,
    }),
  });
  if (!response.ok) throw new Error("MERCHANT_ORDER_CONFIRMATION_FAILED");
  return response.json();
}

async function reconcileCapturedPayment(transactionId: string, paymentId: string) {
  const transaction = getTransactionOrThrow(transactionId);
  recordPayment(transactionId, paymentId, "captured");
  if (getTransaction(transactionId)?.state === "payment_captured") recordPaymentVerified(transactionId);
  const verified = getTransactionOrThrow(transactionId);
  if (verified.state !== "payment_verified") return verified;
  await confirmMerchantOrder(verified);
  return confirmOrder(transactionId);
}

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: [config.buyerAppOrigin, config.merchantAppOrigin] }));

  // Webhooks must be verified against the exact raw request body.
  app.post("/v1/webhooks/razorpay", express.raw({ type: "application/json", limit: "256kb" }), async (request, response) => {
    const rawBody = Buffer.isBuffer(request.body) ? request.body.toString("utf8") : "";
    const signature = request.header("x-razorpay-signature") ?? "";

    if (!verifyWebhookSignature(rawBody, signature)) {
      response.status(400).json({ error: "INVALID_WEBHOOK_SIGNATURE" });
      return;
    }

    const dedupeKey = request.header("x-razorpay-event-id") ?? createHash("sha256").update(rawBody).digest("hex");
    if (processedWebhookKeys.has(dedupeKey)) {
      response.status(200).json({ received: true, duplicate: true });
      return;
    }

    let payload: {
      event?: string;
      payload?: {
        payment?: { entity?: { id?: string; order_id?: string; status?: "created" | "authorized" | "captured" | "refunded" | "failed" } };
        order?: { entity?: { id?: string; status?: string } };
      };
    };

    try {
      payload = JSON.parse(rawBody) as typeof payload;
    } catch {
      response.status(400).json({ error: "INVALID_WEBHOOK_JSON" });
      return;
    }

    const event = payload.event ?? "unknown";
    const payment = payload.payload?.payment?.entity;
    const orderId = payment?.order_id ?? payload.payload?.order?.entity?.id;
    const transaction = orderId ? findTransactionByRazorpayOrderId(orderId) : undefined;

    if (transaction && payment?.id) {
      if (event === "payment.failed") {
        recordPayment(transaction.id, payment.id, "failed");
      } else if (event === "payment.authorized") {
        recordPayment(transaction.id, payment.id, "authorized");
      } else if (event === "payment.captured") {
        await reconcileCapturedPayment(transaction.id, payment.id);
      }
    } else if (transaction && event === "order.paid") {
      const payments = await fetchOrderPayments(transaction.razorpayOrderId!);
      const captured = payments.items.find((item) => item.status === "captured");
      if (captured) await reconcileCapturedPayment(transaction.id, captured.id);
    }

    processedWebhookKeys.add(dedupeKey);
    response.status(200).json({ received: true });
  });

  app.use(express.json({ limit: "32kb" }));

  app.get("/health", (_request, response) => {
    response.json(createHealthStatus("gateway"));
  });

  app.get("/", (_request, response) => {
    response.json({
      name: "MANDATE Gateway",
      role: "deterministic policy, transaction, Razorpay, webhook, and audit boundary",
      status: "razorpay-test-ready",
      testMode: true,
    });
  });

  app.get("/v1/transactions", (_request, response) => {
    response.json({ transactions: getAllTransactions() });
  });

  app.post("/v1/purchase-intents", async (request, response) => {
    try {
      const input = parsePurchaseIntent(request.body);
      const transaction = await proposeTransaction(input);
      response.status(201).json({ transaction });
    } catch (error) {
      const message = error instanceof Error ? error.message : "INVALID_REQUEST";
      const status = message === "INVALID_REQUEST" || message.startsWith("INVALID_") ? 400 : 422;
      response.status(status).json({ error: message });
    }
  });

  app.post("/v1/transactions/:id/razorpay-order", async (request, response) => {
    try {
      const transaction = getTransactionOrThrow(request.params.id);
      if (transaction.state !== "policy_authorized") {
        if (transaction.razorpayOrderId) return response.json({ transaction, razorpayOrderId: transaction.razorpayOrderId });
        return response.status(409).json({ error: "TRANSACTION_NOT_AUTHORIZED", state: transaction.state });
      }

      const order = await createOrder(transaction);
      const updated = attachRazorpayOrder(transaction.id, order.id);
      response.status(201).json({ transaction: updated, order, checkout: getPublicConfig() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "RAZORPAY_ORDER_FAILED";
      const status = message.includes("NOT_CONFIGURED") ? 503 : 422;
      response.status(status).json({ error: message });
    }
  });

  app.post("/v1/transactions/:id/checkout-started", (request, response) => {
    try {
      const transaction = getTransactionOrThrow(request.params.id);
      const updated = transaction.state === "checkout_started" ? transaction : markCheckoutStarted(transaction.id);
      response.json({ transaction: updated, checkout: getPublicConfig() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "CHECKOUT_START_FAILED";
      response.status(422).json({ error: message });
    }
  });

  app.post("/v1/transactions/:id/verify-payment", async (request, response) => {
    try {
      const transaction = getTransactionOrThrow(request.params.id);
      const razorpayPaymentId = typeof request.body?.razorpay_payment_id === "string" ? request.body.razorpay_payment_id : "";
      const razorpayOrderId = typeof request.body?.razorpay_order_id === "string" ? request.body.razorpay_order_id : "";
      const razorpaySignature = typeof request.body?.razorpay_signature === "string" ? request.body.razorpay_signature : "";

      if (!transaction.razorpayOrderId || transaction.razorpayOrderId !== razorpayOrderId) return response.status(400).json({ error: "RAZORPAY_ORDER_MISMATCH" });
      if (!verifyCheckoutSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) return response.status(400).json({ error: "INVALID_CHECKOUT_SIGNATURE" });

      const payment = await fetchPayment(razorpayPaymentId);
      if (payment.order_id !== razorpayOrderId) return response.status(400).json({ error: "PAYMENT_ORDER_MISMATCH" });

      if (payment.status === "failed") {
        const failed = recordPayment(transaction.id, payment.id, "failed");
        return response.json({ transaction: failed, verified: false, payment });
      }
      if (payment.status !== "authorized" && payment.status !== "captured") return response.status(409).json({ error: "PAYMENT_NOT_AUTHORIZED", payment });

      recordPayment(transaction.id, payment.id, payment.status);
      if (payment.status === "captured" && getTransaction(transaction.id)?.state === "payment_captured") recordPaymentVerified(transaction.id);
      return response.json({ transaction: getTransaction(transaction.id), verified: payment.status === "captured", payment });
    } catch (error) {
      const message = error instanceof Error ? error.message : "PAYMENT_VERIFICATION_FAILED";
      response.status(message === "PAYMENT_NOT_CAPTURED" ? 409 : 422).json({ error: message });
    }
  });

  app.post("/v1/transactions/:id/capture", async (request, response) => {
    try {
      const transaction = getTransactionOrThrow(request.params.id);
      if (!transaction.razorpayPaymentId) return response.status(409).json({ error: "PAYMENT_NOT_AVAILABLE" });
      const payment = await fetchPayment(transaction.razorpayPaymentId);
      if (payment.status === "captured") return response.json({ payment, transaction });
      const captured = await capturePayment(payment.id, transaction.quote.totalPaise);
      recordPayment(transaction.id, captured.id, captured.status === "captured" ? "captured" : "authorized");
      return response.json({ payment: captured, transaction: getTransaction(transaction.id) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "CAPTURE_FAILED";
      response.status(422).json({ error: message });
    }
  });

  app.get("/v1/transactions/:id", (request, response) => {
    const transaction = getTransaction(request.params.id);
    if (!transaction) return response.status(404).json({ error: "TRANSACTION_NOT_FOUND" });
    return response.json({ transaction });
  });

  app.get("/v1/transactions/:id/timeline", (request, response) => {
    if (!getTransaction(request.params.id)) return response.status(404).json({ error: "TRANSACTION_NOT_FOUND" });
    return response.json({ events: getTimeline(request.params.id) });
  });

  return app;
}
