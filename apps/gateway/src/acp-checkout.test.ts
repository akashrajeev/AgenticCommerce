import test from "node:test";
import assert from "node:assert/strict";
import { clearAcpCheckoutStore, completeCheckoutSession, createCheckoutSession, getCheckoutSession, updateCheckoutSession, cancelCheckoutSession } from "../../merchant/src/lib/acp-checkout.js";

process.env.ACP_API_KEY = "test-acp-key";

function headers(idempotencyKey?: string): Headers {
  const value = new Headers({
    authorization: "Bearer test-acp-key",
    "api-version": "2026-04-17",
    "request-id": "test-request-001",
  });
  if (idempotencyKey) value.set("idempotency-key", idempotencyKey);
  return value;
}

test.beforeEach(() => clearAcpCheckoutStore());

test("ACP create builds an authoritative checkout from the real merchant catalog", () => {
  const result = createCheckoutSession({ items: [{ id: "hp-001", quantity: 1 }] }, headers("create-1"));
  assert.equal(result.status, 201);
  assert.equal(result.session?.status, "ready_for_payment");
  assert.equal(result.session?.line_items[0]?.item.name, "SoundMax Pro");
  assert.equal(result.session?.line_items[0]?.item.unit_amount, 399900);
  assert.equal(result.session?.totals.find((total) => total.type === "total")?.amount, 471882);
  assert.equal(result.session?.metadata.mandate_merchant_id, "mandate-market");
});

test("ACP create replays the same idempotency key and rejects a changed payload", () => {
  const first = createCheckoutSession({ items: [{ id: "hp-001", quantity: 1 }] }, headers("idem-1"));
  const replay = createCheckoutSession({ items: [{ id: "hp-001", quantity: 1 }] }, headers("idem-1"));
  assert.equal(replay.status, 201);
  assert.equal(replay.replayed, true);
  assert.equal(replay.session?.id, first.session?.id);
  assert.throws(
    () => createCheckoutSession({ items: [{ id: "ms-001", quantity: 1 }] }, headers("idem-1")),
    /Idempotency-Key has already been used with a different request body/,
  );
});

test("ACP update replaces the basket with a fresh merchant quote and increments the version", () => {
  const created = createCheckoutSession({ items: [{ id: "hp-001", quantity: 1 }] }, headers("create-2"));
  const id = created.session?.id;
  assert.ok(id);
  const updated = updateCheckoutSession(id, { items: [{ id: "ms-001", quantity: 1 }] }, headers("update-1"));
  assert.equal(updated.status, 200);
  assert.equal(updated.session?.version, 2);
  assert.equal(updated.session?.line_items[0]?.item.name, "Arc Precision Mouse");
  assert.equal(updated.session?.totals.find((total) => total.type === "total")?.amount, 304782);
  assert.equal(getCheckoutSession(id).metadata.mandate_quote_id, updated.session?.metadata.mandate_quote_id);
});

test("ACP cancel transitions an open session and is not reusable as a payable session", () => {
  const created = createCheckoutSession({ items: [{ id: "hp-001", quantity: 1 }] }, headers("create-3"));
  const id = created.session?.id;
  assert.ok(id);
  const canceled = cancelCheckoutSession(id, {}, headers("cancel-1"));
  assert.equal(canceled.status, 200);
  assert.equal(canceled.session?.status, "canceled");
  assert.throws(() => updateCheckoutSession(id, { items: [{ id: "ms-001", quantity: 1 }] }, headers("update-2")), /cannot be updated/);
});

test("ACP completion cannot bypass the MANDATE authorization boundary", () => {
  const created = createCheckoutSession({ items: [{ id: "hp-001", quantity: 1 }] }, headers("create-4"));
  const id = created.session?.id;
  assert.ok(id);
  assert.throws(
    () => completeCheckoutSession(id, { payment_data: { provider: "razorpay" } }, headers("complete-1")),
    /MANDATE must authorize and bind this checkout/,
  );
  assert.equal(getCheckoutSession(id).status, "requires_escalation");
});

test("ACP rejects requests without the required idempotency key or API version", () => {
  assert.throws(
    () => createCheckoutSession({ items: [{ id: "hp-001", quantity: 1 }] }, headers()),
    /Idempotency-Key header is required/,
  );
  const missingVersion = headers("create-5");
  missingVersion.delete("api-version");
  assert.throws(
    () => createCheckoutSession({ items: [{ id: "hp-001", quantity: 1 }] }, missingVersion),
    /API-Version 2026-04-17 is required/,
  );
});
