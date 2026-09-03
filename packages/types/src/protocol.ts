import type { CheckoutLineItem, MoneyAmount } from "./index.js";

export type CommerceProtocol = "mandate-native" | "acp" | "ap2" | "uap" | "x402";

export type AgentType = "buyer" | "merchant" | "service";

export type AgentIdentity = {
  agentId: string;
  agentType: AgentType;
  name: string;
  issuer?: string;
  keyId?: string;
};

export type MerchantCapability = {
  capabilityId: string;
  name: string;
  version: string;
  protocol: CommerceProtocol;
  methods: string[];
  endpoint: string;
  requiresAuthentication: boolean;
};

export type CommerceItem = {
  productId: string;
  quantity: number;
};

export type CommerceIntent = {
  intentId: string;
  buyer: AgentIdentity;
  merchantId?: string;
  purpose: string;
  items: CommerceItem[];
  maxSpend: MoneyAmount;
  currency: "INR";
  constraints: Record<string, string | number | boolean | null>;
  sourceProtocol: CommerceProtocol;
  createdAt: string;
  expiresAt?: string;
};

export type MerchantOffer = {
  offerId: string;
  intentId: string;
  merchantId: string;
  items: CheckoutLineItem[];
  amount: MoneyAmount;
  quoteId: string;
  conditions: Record<string, string | number | boolean | null>;
  sourceProtocol: CommerceProtocol;
  createdAt: string;
  expiresAt: string;
};

export type NegotiationTurnActor = "buyer_agent" | "merchant_agent";
export type NegotiationTurnType = "intent" | "offer" | "selection" | "counter" | "rejection";

export type NegotiationTurn = {
  turnId: string;
  actor: NegotiationTurnActor;
  type: NegotiationTurnType;
  message: string;
  offerId?: string;
  createdAt: string;
};

export type NegotiationStatus = "proposed" | "accepted" | "rejected" | "expired";

export type NegotiationSession = {
  negotiationId: string;
  intent: CommerceIntent;
  merchant: AgentIdentity;
  offers: MerchantOffer[];
  selectedOfferId?: string;
  status: NegotiationStatus;
  turns: NegotiationTurn[];
  createdAt: string;
  expiresAt: string;
};

export type CheckoutSnapshot = {
  checkoutId: string;
  merchantId: string;
  quoteId: string;
  lineItems: CheckoutLineItem[];
  total: MoneyAmount;
  cartHash: string;
  quoteExpiresAt: string;
  capturedAt: string;
};

export type CheckoutSessionStatus = "open" | "authorized" | "completed" | "cancelled" | "expired";

export type CheckoutSession = {
  checkoutId: string;
  merchantId: string;
  offerId?: string;
  status: CheckoutSessionStatus;
  version: number;
  snapshot: CheckoutSnapshot;
  createdAt: string;
  expiresAt: string;
};

export type MandateApprovalMode = "human_present" | "delegated_autonomous";

export type UserMandate = {
  mandateId: string;
  subjectId: string;
  agentId: string;
  merchantId?: string;
  purpose: string;
  maxSpend: MoneyAmount;
  allowedProductIds?: string[];
  constraints: Record<string, string | number | boolean | null>;
  approvalMode: MandateApprovalMode;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
};

export type DelegatedMandateStatus = "active" | "revoked" | "expired" | "exhausted";

export type DelegatedMandate = {
  mandateId: string;
  subjectId: string;
  agentId: string;
  purpose: string;
  merchantIds: string[];
  allowedProductIds?: string[];
  maxSpendPerPurchase: MoneyAmount;
  totalBudget: MoneyAmount;
  spentPaise: number;
  reservedPaise: number;
  executionCount: number;
  blockedCount: number;
  approvalMode: "delegated_autonomous";
  constraints: Record<string, string | number | boolean | null>;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  status: DelegatedMandateStatus;
};

export type DelegatedMandateExecution = {
  executionId: string;
  mandateId: string;
  transactionId: string;
  amount: MoneyAmount;
  status: "reserved" | "confirmed" | "released";
  createdAt: string;
};

export type MandateCredential = {
  algorithm: "Ed25519";
  keyId?: string;
  publicKeyPem: string;
  signatureBase64: string;
};

export type SignedUserMandate = UserMandate & {
  credential: MandateCredential;
};

export type CheckoutMandate = {
  mandateId: string;
  checkoutId: string;
  merchantId: string;
  cartHash: string;
  amount: MoneyAmount;
  createdAt: string;
  expiresAt: string;
  nonce: string;
};

export type PaymentMandate = {
  mandateId: string;
  checkoutMandateId: string;
  authorizationId?: string;
  merchantId: string;
  cartHash: string;
  amount: MoneyAmount;
  paymentRail: string;
  createdAt: string;
  expiresAt: string;
  nonce: string;
};

export type PaymentAuthorizationStatus = "authorized" | "declined" | "consumed" | "expired";

export type PaymentAuthorization = {
  authorizationId: string;
  mandateId: string;
  checkoutSessionId: string;
  merchantId: string;
  amount: MoneyAmount;
  cartHash: string;
  paymentRail: string;
  status: PaymentAuthorizationStatus;
  createdAt: string;
  expiresAt: string;
  nonce: string;
};

export type PaymentReceiptStatus = "authorized" | "captured" | "failed" | "refunded";

export type PaymentReceipt = {
  receiptId: string;
  authorizationId: string;
  paymentRail: string;
  externalReference: string;
  amount: MoneyAmount;
  status: PaymentReceiptStatus;
  receivedAt: string;
  capturedAt?: string;
};

export type ProtocolEnvelope<TPayload> = {
  protocol: CommerceProtocol;
  version: string;
  messageType: string;
  messageId: string;
  createdAt: string;
  payload: TPayload;
};

export type CheckoutBindingInput = {
  checkoutId: string;
  merchantId: string;
  quoteId: string;
  currency: "INR";
  totalPaise: number;
  lineItems: CheckoutLineItem[];
  expiresAt: string;
};

export function canonicalizeCheckoutBinding(input: CheckoutBindingInput): string {
  const items = [...input.lineItems]
    .map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      unitPricePaise: line.unitPricePaise,
      lineTotalPaise: line.lineTotalPaise,
    }))
    .sort((a, b) => a.productId.localeCompare(b.productId));

  return JSON.stringify({
    checkoutId: input.checkoutId,
    merchantId: input.merchantId,
    quoteId: input.quoteId,
    currency: input.currency,
    totalPaise: input.totalPaise,
    expiresAt: input.expiresAt,
    lineItems: items,
  });
}
