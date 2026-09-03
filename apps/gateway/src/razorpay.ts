import { createHmac, timingSafeEqual } from "node:crypto";
import type { Transaction } from "@mandate/types";
import { config } from "./config.js";

export type RazorpayOrder = {
  id: string;
  entity: "order";
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string;
  status: "created" | "attempted" | "paid";
  attempts: number;
  notes: Record<string, string>;
  created_at: number;
};

export type RazorpayPayment = {
  id: string;
  entity: "payment";
  amount: number;
  currency: string;
  order_id: string | null;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  method?: string;
  captured?: boolean;
  error_code?: string | null;
  error_description?: string | null;
};

type RazorpayError = { error?: { code?: string; description?: string } };

export function isRazorpayTestMode(): boolean {
  return Boolean(config.razorpayKeyId && config.razorpayKeyId.startsWith("rzp_test_"));
}

function requireCredentials() {
  if (!config.razorpayKeyId || !config.razorpayKeySecret) {
    throw new Error("RAZORPAY_TEST_CREDENTIALS_NOT_CONFIGURED");
  }
  if (!config.razorpayKeyId.startsWith("rzp_test_")) {
    throw new Error("RAZORPAY_TEST_MODE_REQUIRED");
  }
}

async function razorpayRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  requireCredentials();
  const token = Buffer.from(`${config.razorpayKeyId}:${config.razorpayKeySecret}`).toString("base64");
  const response = await fetch(`${config.razorpayBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const body = (await response.json().catch(() => null)) as T | RazorpayError | null;
  if (!response.ok) {
    const error = body as RazorpayError | null;
    throw new Error(`RAZORPAY_${error?.error?.code ?? response.status}:${error?.error?.description ?? "request failed"}`);
  }
  return body as T;
}

export async function createOrder(transaction: Transaction): Promise<RazorpayOrder> {
  return razorpayRequest<RazorpayOrder>("/orders", {
    method: "POST",
    body: JSON.stringify({
      amount: transaction.quote.totalPaise,
      currency: transaction.quote.currency,
      receipt: transaction.id,
      notes: {
        mandate_transaction_id: transaction.id,
        merchant_id: transaction.intent.merchantId,
        product_id: transaction.intent.productId,
      },
    }),
  });
}

export async function fetchOrder(orderId: string): Promise<RazorpayOrder> {
  return razorpayRequest<RazorpayOrder>(`/orders/${encodeURIComponent(orderId)}`);
}

export async function fetchPayment(paymentId: string): Promise<RazorpayPayment> {
  return razorpayRequest<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}`);
}

export async function fetchOrderPayments(orderId: string): Promise<{ items: RazorpayPayment[] }> {
  return razorpayRequest<{ items: RazorpayPayment[] }>(`/orders/${encodeURIComponent(orderId)}/payments`);
}

export async function capturePayment(paymentId: string, amountPaise: number): Promise<RazorpayPayment> {
  return razorpayRequest<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}/capture`, {
    method: "POST",
    body: JSON.stringify({ amount: amountPaise, currency: "INR" }),
  });
}

export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
  if (!isRazorpayTestMode() || !config.razorpayKeySecret || !orderId || !paymentId || !signature) return false;
  const expected = createHmac("sha256", config.razorpayKeySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(signature, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  if (!isRazorpayTestMode() || !config.razorpayWebhookSecret || !signature) return false;
  const expected = createHmac("sha256", config.razorpayWebhookSecret)
    .update(rawBody, "utf8")
    .digest("hex");

  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(signature, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function getPublicConfig() {
  if (!config.razorpayKeyId) throw new Error("RAZORPAY_TEST_KEY_ID_NOT_CONFIGURED");
  if (!config.razorpayKeyId.startsWith("rzp_test_")) throw new Error("RAZORPAY_TEST_MODE_REQUIRED");
  return { keyId: config.razorpayKeyId, currency: "INR" as const };
}
