import { createHash, createHmac } from "node:crypto";
import type {
  CheckoutBindingInput,
  CheckoutMandate,
  PaymentAuthorization,
  PaymentMandate,
  PurchaseIntent,
  Transaction,
  UserMandate,
} from "@mandate/types";
import { canonicalizeCheckoutBinding } from "@mandate/types";
import { config } from "./config.js";
import { proposeTransaction } from "./transaction-core.js";

export type MandateCheckoutBindingInput = CheckoutBindingInput & {
  cartHash: string;
};

export type MandateAuthorizationInput = {
  userMandate: UserMandate;
  checkout: MandateCheckoutBindingInput;
  paymentRail: string;
};

export type MandateAuthorizationResult = {
  transaction: Transaction;
  checkoutMandate: CheckoutMandate;
  paymentMandate: PaymentMandate;
  authorization: PaymentAuthorization;
  binding: string;
  bindingSignature: string;
};

function assertSafeTime(value: string, field: string): number {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) throw new Error(`INVALID_MANDATE_${field.toUpperCase()}`);
  return time;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mandateExpiry(userMandate: UserMandate, checkout: CheckoutBindingInput): string {
  return new Date(Math.min(assertSafeTime(userMandate.expiresAt, "expiry"), assertSafeTime(checkout.expiresAt, "checkout_expiry"))).toISOString();
}

function checkoutCartHash(checkout: CheckoutBindingInput): string {
  return createHash("sha256").update(canonicalizeCheckoutBinding(checkout)).digest("hex");
}

function signBinding(binding: string): string {
  return createHmac("sha256", config.internalGatewaySecret).update(binding).digest("hex");
}

function validateMandateShape(userMandate: UserMandate, checkout: MandateCheckoutBindingInput, paymentRail: string): void {
  const now = Date.now();
  const issuedAt = assertSafeTime(userMandate.issuedAt, "issued_at");
  const mandateExpiresAt = assertSafeTime(userMandate.expiresAt, "expiry");
  const checkoutExpiresAt = assertSafeTime(checkout.expiresAt, "checkout_expiry");
  if (!userMandate.mandateId || !userMandate.subjectId || !userMandate.agentId) throw new Error("INVALID_MANDATE_IDENTITY");
  if (!userMandate.purpose.trim()) throw new Error("INVALID_MANDATE_PURPOSE");
  if (issuedAt > now + 5_000) throw new Error("MANDATE_NOT_YET_VALID");
  if (mandateExpiresAt <= now) throw new Error("MANDATE_EXPIRED");
  if (checkoutExpiresAt <= now) throw new Error("CHECKOUT_BINDING_EXPIRED");
  if (checkout.totalPaise < 0 || !Number.isSafeInteger(checkout.totalPaise)) throw new Error("INVALID_CHECKOUT_AMOUNT");
  if (userMandate.maxSpend.currency !== checkout.currency) throw new Error("MANDATE_CURRENCY_MISMATCH");
  if (userMandate.maxSpend.amountPaise < checkout.totalPaise) throw new Error("MANDATE_SPEND_LIMIT_EXCEEDED");
  if (userMandate.merchantId && userMandate.merchantId !== checkout.merchantId) throw new Error("MANDATE_MERCHANT_MISMATCH");
  if (!paymentRail.trim()) throw new Error("PAYMENT_RAIL_REQUIRED");
  if (userMandate.allowedProductIds) {
    const allowed = new Set(userMandate.allowedProductIds);
    if (checkout.lineItems.some((line) => !allowed.has(line.productId))) throw new Error("MANDATE_PRODUCT_NOT_ALLOWED");
  }
  if (!checkout.lineItems.length || checkout.lineItems.length > 10) throw new Error("INVALID_CHECKOUT_ITEMS");
  if (checkout.lineItems.some((line) => !line.productId || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.unitPricePaise < 0 || line.lineTotalPaise !== line.unitPricePaise * line.quantity)) throw new Error("INVALID_CHECKOUT_LINE");
  if (checkoutCartHash(checkout) !== checkout.cartHash) throw new Error("CHECKOUT_CART_HASH_MISMATCH");
}

export async function authorizeCheckout(input: MandateAuthorizationInput): Promise<MandateAuthorizationResult> {
  validateMandateShape(input.userMandate, input.checkout, input.paymentRail);
  const binding = canonicalizeCheckoutBinding(input.checkout);
  const bindingSignature = signBinding(binding);
  const firstLine = input.checkout.lineItems[0];
  if (!firstLine) throw new Error("INVALID_CHECKOUT_ITEMS");

  const purchaseIntent: Omit<PurchaseIntent, "id"> = {
    merchantId: input.checkout.merchantId,
    productId: firstLine.productId,
    quantity: firstLine.quantity,
    lineItems: input.checkout.lineItems.map((line) => ({ productId: line.productId, quantity: line.quantity })),
    maxSpendPaise: input.userMandate.maxSpend.amountPaise,
    reason: input.userMandate.purpose,
    quoteId: input.checkout.quoteId,
  };
  const transaction = await proposeTransaction(purchaseIntent);
  if (transaction.state !== "policy_authorized") throw new Error(`MANDATE_POLICY_BLOCKED:${transaction.state}`);
  if (transaction.quote.totalPaise !== input.checkout.totalPaise) throw new Error("MANDATE_AMOUNT_REVALIDATION_FAILED");
  const rebound = canonicalizeCheckoutBinding({ ...input.checkout, totalPaise: transaction.quote.totalPaise });
  if (rebound !== binding) throw new Error("MANDATE_BINDING_CHANGED");

  const expiresAt = mandateExpiry(input.userMandate, input.checkout);
  const createdAt = nowIso();
  const checkoutMandate: CheckoutMandate = {
    mandateId: input.userMandate.mandateId,
    checkoutId: input.checkout.checkoutId,
    merchantId: input.checkout.merchantId,
    cartHash: input.checkout.cartHash,
    amount: { currency: "INR", amountPaise: transaction.quote.totalPaise },
    createdAt,
    expiresAt,
    nonce: input.userMandate.nonce,
  };
  const authorizationId = `auth_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const paymentMandate: PaymentMandate = {
    mandateId: input.userMandate.mandateId,
    checkoutMandateId: `${input.userMandate.mandateId}:${input.checkout.checkoutId}`,
    authorizationId,
    merchantId: input.checkout.merchantId,
    cartHash: input.checkout.cartHash,
    amount: { currency: "INR", amountPaise: transaction.quote.totalPaise },
    paymentRail: input.paymentRail,
    createdAt,
    expiresAt,
    nonce: input.userMandate.nonce,
  };
  const authorization: PaymentAuthorization = {
    authorizationId,
    mandateId: input.userMandate.mandateId,
    checkoutSessionId: input.checkout.checkoutId,
    merchantId: input.checkout.merchantId,
    amount: { currency: "INR", amountPaise: transaction.quote.totalPaise },
    cartHash: input.checkout.cartHash,
    paymentRail: input.paymentRail,
    status: "authorized",
    createdAt,
    expiresAt,
  };
  return { transaction, checkoutMandate, paymentMandate, authorization, binding, bindingSignature };
}
