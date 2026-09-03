import { createHash } from "node:crypto";
import type { CheckoutLineItem, MerchantOffer, PaymentAuthorization, Transaction } from "@mandate/types";
import { canonicalizeCheckoutBinding } from "@mandate/types";
import { config } from "./config.js";
import { executeDelegatedMandate, delegatedMandateStats } from "./delegated-mandates.js";
import { getTransaction } from "./transaction-core.js";

const accepted = new Map<string, { transactionId: string; executionId: string; authorizationId: string; offer: MerchantOffer }>();

type MerchantQuoteResponse = {
  quote?: {
    quoteId: string;
    merchantId: string;
    lineItems: CheckoutLineItem[];
    totalPaise: number;
    currency: "INR";
    expiresAt: string;
  };
};

type MerchantNegotiationResponse = {
  negotiationId: string;
  offers: MerchantOffer[];
};

type NegotiatedAcceptanceResult = {
  replayed: boolean;
  transactionId: string;
  executionId: string;
  authorizationId: string;
  offer: MerchantOffer;
  transaction: Transaction;
  authorization: PaymentAuthorization;
  mandate: ReturnType<typeof delegatedMandateStats>;
};

function sameItems(a: CheckoutLineItem[], b: CheckoutLineItem[]): boolean {
  if (a.length !== b.length) return false;
  const normalize = (items: CheckoutLineItem[]) => [...items]
    .map((item) => `${item.productId}:${item.quantity}:${item.unitPricePaise}:${item.lineTotalPaise}`)
    .sort();
  return normalize(a).join("|") === normalize(b).join("|");
}

async function fetchMerchantOfferAttestation(negotiationId: string, offer: MerchantOffer) {
  const response = await fetch(`${config.merchantInternalUrl}/api/agent/negotiate/${encodeURIComponent(negotiationId)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("NEGOTIATION_NOT_FOUND");
  const body = await response.json().catch(() => null) as MerchantNegotiationResponse | null;
  if (!body || body.negotiationId !== negotiationId) throw new Error("NEGOTIATION_NOT_FOUND");
  const issued = body.offers.find((candidate) => candidate.offerId === offer.offerId);
  if (!issued) throw new Error("NEGOTIATED_OFFER_NOT_ISSUED");
  if (issued.intentId !== offer.intentId || issued.merchantId !== offer.merchantId || issued.quoteId !== offer.quoteId) throw new Error("NEGOTIATED_OFFER_ATTESTATION_MISMATCH");
  if (issued.amount.currency !== offer.amount.currency || issued.amount.amountPaise !== offer.amount.amountPaise) throw new Error("NEGOTIATED_OFFER_ATTESTATION_MISMATCH");
  if (issued.sourceProtocol !== offer.sourceProtocol || issued.expiresAt !== offer.expiresAt) throw new Error("NEGOTIATED_OFFER_ATTESTATION_MISMATCH");
  if (!sameItems(issued.items, offer.items)) throw new Error("NEGOTIATED_OFFER_ATTESTATION_MISMATCH");
  return issued;
}

async function fetchAuthoritativeQuote(offer: MerchantOffer) {
  const response = await fetch(`${config.merchantInternalUrl}/api/agent/checkout/quotes/${encodeURIComponent(offer.quoteId)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("NEGOTIATED_OFFER_QUOTE_NOT_FOUND");
  const body = await response.json().catch(() => null) as MerchantQuoteResponse | null;
  const quote = body?.quote;
  if (!quote) throw new Error("NEGOTIATED_OFFER_QUOTE_NOT_FOUND");
  if (quote.merchantId !== offer.merchantId) throw new Error("NEGOTIATED_OFFER_MERCHANT_MISMATCH");
  if (quote.quoteId !== offer.quoteId) throw new Error("NEGOTIATED_OFFER_QUOTE_MISMATCH");
  if (quote.currency !== offer.amount.currency || quote.totalPaise !== offer.amount.amountPaise) throw new Error("NEGOTIATED_OFFER_AMOUNT_MISMATCH");
  if (!sameItems(quote.lineItems, offer.items)) throw new Error("NEGOTIATED_OFFER_ITEMS_MISMATCH");
  if (new Date(quote.expiresAt).getTime() <= Date.now()) throw new Error("NEGOTIATED_OFFER_EXPIRED");
  return quote;
}

export async function acceptNegotiatedOffer(input: { negotiationId: string; mandateId: string; offer: MerchantOffer }): Promise<NegotiatedAcceptanceResult> {
  const key = `${input.negotiationId}:${input.mandateId}:${input.offer.offerId}`;
  const existing = accepted.get(key);
  if (existing) {
    const transaction = getTransaction(existing.transactionId);
    if (!transaction?.mandateAuthorization) throw new Error("NEGOTIATION_TRANSACTION_NOT_FOUND");
    return {
      replayed: true,
      transactionId: existing.transactionId,
      executionId: existing.executionId,
      authorizationId: existing.authorizationId,
      offer: existing.offer,
      transaction,
      authorization: {
        authorizationId: existing.authorizationId,
        mandateId: input.mandateId,
        checkoutSessionId: transaction.mandateAuthorization.checkoutSessionId,
        merchantId: transaction.mandateAuthorization.merchantId,
        amount: transaction.mandateAuthorization.amount,
        cartHash: transaction.mandateAuthorization.cartHash,
        paymentRail: transaction.mandateAuthorization.paymentRail,
        status: transaction.mandateAuthorization.status,
        createdAt: transaction.mandateAuthorization.createdAt,
        expiresAt: transaction.mandateAuthorization.expiresAt,
        nonce: transaction.mandateAuthorization.nonce,
      },
      mandate: delegatedMandateStats(input.mandateId),
    };
  }

  if (!input.negotiationId.trim()) throw new Error("INVALID_NEGOTIATION_ID");
  if (!input.mandateId.trim()) throw new Error("INVALID_NEGOTIATION_MANDATE");
  if (!input.offer.offerId.trim() || !input.offer.intentId.trim()) throw new Error("INVALID_NEGOTIATED_OFFER");
  if (input.offer.sourceProtocol === "x402") throw new Error("NEGOTIATED_OFFER_PAYMENT_RAIL_UNSUPPORTED");
  if (new Date(input.offer.expiresAt).getTime() <= Date.now()) throw new Error("NEGOTIATED_OFFER_EXPIRED");
  if (!Number.isSafeInteger(input.offer.amount.amountPaise) || input.offer.amount.amountPaise <= 0) throw new Error("INVALID_NEGOTIATED_OFFER_AMOUNT");
  if (!input.offer.items.length) throw new Error("INVALID_NEGOTIATED_OFFER_ITEMS");
  if (input.offer.items.some((item) => item.lineTotalPaise !== item.unitPricePaise * item.quantity)) throw new Error("INVALID_NEGOTIATED_OFFER_LINE");

  const issued = await fetchMerchantOfferAttestation(input.negotiationId, input.offer);
  const quote = await fetchAuthoritativeQuote(issued);
  const expiresAt = new Date(Math.min(new Date(issued.expiresAt).getTime(), new Date(quote.expiresAt).getTime())).toISOString();
  const checkoutId = `neg_${input.negotiationId}_${issued.offerId}`;
  const binding = { checkoutId, merchantId: quote.merchantId, quoteId: quote.quoteId, currency: quote.currency, totalPaise: quote.totalPaise, lineItems: quote.lineItems, expiresAt };
  const cartHash = createHash("sha256").update(canonicalizeCheckoutBinding(binding)).digest("hex");
  const result = await executeDelegatedMandate(input.mandateId, { ...binding, cartHash });
  const acceptedResult: NegotiatedAcceptanceResult = {
    replayed: false,
    transactionId: result.authorization.transaction.id,
    executionId: result.execution.executionId,
    authorizationId: result.authorization.authorization.authorizationId,
    offer: issued,
    transaction: result.authorization.transaction,
    authorization: result.authorization.authorization,
    mandate: delegatedMandateStats(input.mandateId),
  };
  accepted.set(key, {
    transactionId: acceptedResult.transactionId,
    executionId: acceptedResult.executionId,
    authorizationId: acceptedResult.authorizationId,
    offer: issued,
  });
  return acceptedResult;
}

export function clearNegotiationAcceptanceStore(): void {
  accepted.clear();
}
