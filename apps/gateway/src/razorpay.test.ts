import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

process.env.RAZORPAY_KEY_ID = "rzp_test_unit";
process.env.RAZORPAY_KEY_SECRET = "unit-test-key-secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "unit-test-webhook-secret";

const { createOrder, isRazorpayTestMode, verifyCheckoutSignature, verifyWebhookSignature } = await import("./razorpay.js");

const originalFetch = globalThis.fetch;

test.after(() => { globalThis.fetch = originalFetch; });

test("Razorpay runtime is explicitly configured for Test Mode", () => {
  assert.equal(isRazorpayTestMode(), true);
});

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

test("createOrder carries campaign attribution into Razorpay Test Mode notes", async () => {
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      id: "order_test_growth",
      entity: "order",
      amount: 439900,
      amount_paid: 0,
      amount_due: 439900,
      currency: "INR",
      receipt: "txn_growth_001",
      status: "created",
      attempts: 0,
      notes: requestBody?.notes ?? {},
      created_at: 1,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const order = await createOrder({
    id: "txn_growth_001",
    intent: { merchantId: "mandate-market", productId: "hp-001" },
    quote: { totalPaise: 439900, currency: "INR" },
  } as unknown as import("@mandate/types").Transaction, { campaignId: "headphone-aov" });

  assert.equal(order.id, "order_test_growth");
  const notes = requestBody?.notes as Record<string, unknown>;
  assert.equal(notes.growth_campaign_id, "headphone-aov");
  assert.equal(notes.mandate_transaction_id, "txn_growth_001");
});

test("createOrder rejects an invalid campaign identifier before calling Razorpay", async () => {
  let called = false;
  globalThis.fetch = (async () => { called = true; return new Response("{}", { status: 500 }); }) as typeof fetch;
  await assert.rejects(
    () => createOrder({ id: "txn_growth_002", intent: { merchantId: "mandate-market", productId: "hp-001" }, quote: { totalPaise: 399900, currency: "INR" } } as unknown as import("@mandate/types").Transaction, { campaignId: "BAD_CAMPAIGN" }),
    /INVALID_GROWTH_CAMPAIGN_ID/,
  );
  assert.equal(called, false);
});