import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { NextResponse } from "next/server";
import type { CheckoutLineItem, SignedUserMandate } from "@mandate/types";
import { canonicalizeCheckoutBinding } from "@mandate/types";

const GATEWAY_INTERNAL_URL = (process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");
const INTERNAL_GATEWAY_SECRET = process.env.INTERNAL_GATEWAY_SECRET ?? "";

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

function canonicalizeUserMandate(mandate: Omit<SignedUserMandate, "credential">): string {
  return JSON.stringify(stableValue(mandate));
}

function parseLineItems(value: unknown): CheckoutLineItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) throw new Error("INVALID_LINE_ITEMS");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("INVALID_LINE_ITEMS");
    const line = entry as Record<string, unknown>;
    const productId = typeof line.productId === "string" ? line.productId.trim() : "";
    const quantity = typeof line.quantity === "number" ? line.quantity : NaN;
    const unitPricePaise = typeof line.unitPricePaise === "number" ? line.unitPricePaise : NaN;
    const lineTotalPaise = typeof line.lineTotalPaise === "number" ? line.lineTotalPaise : NaN;
    if (!productId || !Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(unitPricePaise) || unitPricePaise < 0 || !Number.isSafeInteger(lineTotalPaise) || lineTotalPaise !== unitPricePaise * quantity) throw new Error("INVALID_LINE_ITEMS");
    return { productId, quantity, unitPricePaise, lineTotalPaise };
  });
}

export async function POST(request: Request) {
  if (!INTERNAL_GATEWAY_SECRET) return NextResponse.json({ error: "INTERNAL_GATEWAY_SECRET_NOT_CONFIGURED" }, { status: 503 });
  const input = await request.json().catch(() => null) as {
    quote?: unknown;
    maxSpendPaise?: unknown;
    reason?: unknown;
  } | null;

  try {
    if (!input?.quote || typeof input.quote !== "object") throw new Error("QUOTE_REQUIRED");
    const quote = input.quote as Record<string, unknown>;
    const quoteId = typeof quote.quoteId === "string" ? quote.quoteId.trim() : "";
    const merchantId = typeof quote.merchantId === "string" ? quote.merchantId.trim() : "";
    const currency = quote.currency === "INR" ? "INR" as const : null;
    const totalPaise = typeof quote.totalPaise === "number" ? quote.totalPaise : NaN;
    const quoteExpiresAt = typeof quote.expiresAt === "string" ? quote.expiresAt : "";
    const lineItems = parseLineItems(quote.lineItems);
    const maxSpendPaise = typeof input.maxSpendPaise === "number" ? input.maxSpendPaise : NaN;
    const reason = typeof input.reason === "string" ? input.reason.trim() : "Approved growth basket";
    if (!quoteId || !merchantId || currency !== "INR" || !Number.isSafeInteger(totalPaise) || totalPaise < 0 || !quoteExpiresAt || !Number.isSafeInteger(maxSpendPaise) || maxSpendPaise < totalPaise || !reason) throw new Error("INVALID_GROWTH_APPROVAL");
    if (new Date(quoteExpiresAt).getTime() <= Date.now()) throw new Error("QUOTE_EXPIRED");

    const checkoutId = `growth_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const cartBinding = { checkoutId, merchantId, quoteId, currency, totalPaise, lineItems, expiresAt: quoteExpiresAt };
    const cartHash = createHash("sha256").update(canonicalizeCheckoutBinding(cartBinding)).digest("hex");
    const issuedAt = new Date().toISOString();
    const mandateExpiresAt = new Date(Math.min(new Date(quoteExpiresAt).getTime(), Date.now() + 5 * 60 * 1000)).toISOString();
    const userMandate: Omit<SignedUserMandate, "credential"> = {
      mandateId: `growth_mandate_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`,
      subjectId: "demo-user",
      agentId: "growth-buyer",
      merchantId,
      purpose: reason,
      maxSpend: { currency: "INR", amountPaise: maxSpendPaise },
      allowedProductIds: [...new Set(lineItems.map((line) => line.productId))],
      constraints: { source: "growth-explicit-approval" },
      approvalMode: "human_present",
      nonce: `growth_nonce_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`,
      issuedAt,
      expiresAt: mandateExpiresAt,
    };

    const keyPair = generateKeyPairSync("ed25519");
    const publicKeyPem = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const signatureBase64 = sign(null, Buffer.from(canonicalizeUserMandate(userMandate), "utf8"), keyPair.privateKey).toString("base64");
    const signedMandate: SignedUserMandate = {
      ...userMandate,
      credential: { algorithm: "Ed25519", keyId: "growth-demo-user-ephemeral", publicKeyPem, signatureBase64 },
    };

    const response = await fetch(`${GATEWAY_INTERNAL_URL}/v1/mandates/authorize`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-mandate-gateway-secret": INTERNAL_GATEWAY_SECRET },
      body: JSON.stringify({ userMandate: signedMandate, checkout: { ...cartBinding, cartHash }, paymentRail: "razorpay_standard_checkout" }),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) return NextResponse.json(body ?? { error: "MANDATE_AUTHORIZATION_FAILED" }, { status: response.status });
    return NextResponse.json({ ...body, demoCredential: { algorithm: signedMandate.credential.algorithm, keyId: signedMandate.credential.keyId } }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GROWTH_APPROVAL_FAILED";
    const status = message === "QUOTE_EXPIRED" ? 409 : message.startsWith("INVALID_") ? 400 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
