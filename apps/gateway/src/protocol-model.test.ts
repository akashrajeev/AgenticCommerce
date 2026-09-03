import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeCheckoutBinding } from "@mandate/types";

const base = {
  checkoutId: "chk_test",
  merchantId: "mandate-market",
  quoteId: "quote_test",
  currency: "INR" as const,
  totalPaise: 649800,
  expiresAt: "2026-09-03T18:00:00.000Z",
};

test("canonical checkout binding is independent of line-item ordering", () => {
  const first = canonicalizeCheckoutBinding({
    ...base,
    lineItems: [
      { productId: "ms-001", quantity: 1, unitPricePaise: 249900, lineTotalPaise: 249900 },
      { productId: "hp-001", quantity: 1, unitPricePaise: 399900, lineTotalPaise: 399900 },
    ],
  });
  const second = canonicalizeCheckoutBinding({
    ...base,
    lineItems: [
      { productId: "hp-001", quantity: 1, unitPricePaise: 399900, lineTotalPaise: 399900 },
      { productId: "ms-001", quantity: 1, unitPricePaise: 249900, lineTotalPaise: 249900 },
    ],
  });

  assert.equal(first, second);
});

test("canonical checkout binding changes when the trusted amount changes", () => {
  const original = canonicalizeCheckoutBinding({
    ...base,
    lineItems: [{ productId: "hp-001", quantity: 1, unitPricePaise: 399900, lineTotalPaise: 399900 }],
  });
  const tampered = canonicalizeCheckoutBinding({
    ...base,
    totalPaise: 399800,
    lineItems: [{ productId: "hp-001", quantity: 1, unitPricePaise: 399900, lineTotalPaise: 399900 }],
  });

  assert.notEqual(original, tampered);
});

test("canonical checkout binding changes when merchant or quantity changes", () => {
  const original = canonicalizeCheckoutBinding({
    ...base,
    lineItems: [{ productId: "hp-001", quantity: 1, unitPricePaise: 399900, lineTotalPaise: 399900 }],
  });
  const differentMerchant = canonicalizeCheckoutBinding({
    ...base,
    merchantId: "other-merchant",
    lineItems: [{ productId: "hp-001", quantity: 1, unitPricePaise: 399900, lineTotalPaise: 399900 }],
  });
  const differentQuantity = canonicalizeCheckoutBinding({
    ...base,
    lineItems: [{ productId: "hp-001", quantity: 2, unitPricePaise: 399900, lineTotalPaise: 799800 }],
    totalPaise: 799800,
  });

  assert.notEqual(original, differentMerchant);
  assert.notEqual(original, differentQuantity);
});
