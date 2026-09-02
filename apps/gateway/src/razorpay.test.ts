import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

process.env.RAZORPAY_KEY_SECRET = "unit-test-key-secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "unit-test-webhook-secret";

const { verifyCheckoutSignature, verifyWebhookSignature } = await import("./razorpay.js");

test("checkout signature accepts a correctly signed order/payment pair", () => {
  const orderId = "order_test";
  const paymentId = "pay_test";
  const signature = createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  assert.equal(verifyCheckoutSignature(orderId, paymentId, signature), true);
  assert.equal(verifyCheckoutSignature(orderId, paymentId, `${signature.slice(0, -1)}0`), false);
});

test("webhook signature is validated against the raw payload", () => {
  const body = '{"event":"payment.captured"}';
  const signature = createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!)
    .update(body)
    .digest("hex");

  assert.equal(verifyWebhookSignature(body, signature), true);
  assert.equal(verifyWebhookSignature(`${body} `, signature), false);
});
