import { z } from "zod";

export const commerceProtocolSchema = z.enum(["mandate-native", "acp", "ap2", "uap", "x402"]);
export const agentTypeSchema = z.enum(["buyer", "merchant", "service"]);
export const mandateApprovalModeSchema = z.enum(["human_present", "delegated_autonomous"]);
export const paymentAuthorizationStatusSchema = z.enum(["authorized", "declined", "consumed", "expired"]);
export const paymentReceiptStatusSchema = z.enum(["authorized", "captured", "failed", "refunded"]);

const metadataSchema = z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]));
const moneySchema = z.object({
  currency: z.literal("INR"),
  amountPaise: z.number().int().nonnegative(),
});

export const agentIdentitySchema = z.object({
  agentId: z.string().min(1),
  agentType: agentTypeSchema,
  name: z.string().min(1),
  issuer: z.string().min(1).optional(),
  keyId: z.string().min(1).optional(),
});

export const merchantCapabilitySchema = z.object({
  capabilityId: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  protocol: commerceProtocolSchema,
  methods: z.array(z.string().min(1)).min(1),
  endpoint: z.string().url(),
  requiresAuthentication: z.boolean(),
});

export const commerceItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive().max(10),
});

export const commerceIntentSchema = z.object({
  intentId: z.string().min(1),
  buyer: agentIdentitySchema,
  merchantId: z.string().min(1).optional(),
  purpose: z.string().min(1).max(500),
  items: z.array(commerceItemSchema).min(1).max(10),
  maxSpend: moneySchema,
  currency: z.literal("INR"),
  constraints: metadataSchema,
  sourceProtocol: commerceProtocolSchema,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
});

export const merchantOfferSchema = z.object({
  offerId: z.string().min(1),
  intentId: z.string().min(1),
  merchantId: z.string().min(1),
  items: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.number().int().positive().max(10),
    unitPricePaise: z.number().int().nonnegative(),
    lineTotalPaise: z.number().int().nonnegative(),
  })).min(1).max(10),
  amount: moneySchema,
  quoteId: z.string().min(1),
  conditions: metadataSchema,
  sourceProtocol: commerceProtocolSchema,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const checkoutSnapshotSchema = z.object({
  checkoutId: z.string().min(1),
  merchantId: z.string().min(1),
  quoteId: z.string().min(1),
  lineItems: merchantOfferSchema.shape.items,
  total: moneySchema,
  cartHash: z.string().min(1),
  quoteExpiresAt: z.string().datetime(),
  capturedAt: z.string().datetime(),
});

export const checkoutSessionSchema = z.object({
  checkoutId: z.string().min(1),
  merchantId: z.string().min(1),
  offerId: z.string().min(1).optional(),
  status: z.enum(["open", "authorized", "completed", "cancelled", "expired"]),
  version: z.number().int().positive(),
  snapshot: checkoutSnapshotSchema,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const userMandateSchema = z.object({
  mandateId: z.string().min(1),
  subjectId: z.string().min(1),
  agentId: z.string().min(1),
  merchantId: z.string().min(1).optional(),
  purpose: z.string().min(1).max(500),
  maxSpend: moneySchema,
  allowedProductIds: z.array(z.string().min(1)).max(100).optional(),
  constraints: metadataSchema,
  approvalMode: mandateApprovalModeSchema,
  nonce: z.string().min(16),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const mandateCredentialSchema = z.object({
  algorithm: z.literal("Ed25519"),
  keyId: z.string().min(1).optional(),
  publicKeyPem: z.string().min(1),
  signatureBase64: z.string().min(1),
});

export const signedUserMandateSchema = userMandateSchema.extend({ credential: mandateCredentialSchema });

export const checkoutMandateSchema = z.object({
  mandateId: z.string().min(1),
  checkoutId: z.string().min(1),
  merchantId: z.string().min(1),
  cartHash: z.string().min(1),
  amount: moneySchema,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  nonce: z.string().min(16),
});

export const paymentMandateSchema = z.object({
  mandateId: z.string().min(1),
  checkoutMandateId: z.string().min(1),
  authorizationId: z.string().min(1).optional(),
  merchantId: z.string().min(1),
  cartHash: z.string().min(1),
  amount: moneySchema,
  paymentRail: z.string().min(1),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  nonce: z.string().min(16),
});

export const paymentAuthorizationSchema = z.object({
  authorizationId: z.string().min(1),
  mandateId: z.string().min(1),
  checkoutSessionId: z.string().min(1),
  merchantId: z.string().min(1),
  amount: moneySchema,
  cartHash: z.string().min(1),
  paymentRail: z.string().min(1),
  status: paymentAuthorizationStatusSchema,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const paymentReceiptSchema = z.object({
  receiptId: z.string().min(1),
  authorizationId: z.string().min(1),
  paymentRail: z.string().min(1),
  externalReference: z.string().min(1),
  amount: moneySchema,
  status: paymentReceiptStatusSchema,
  receivedAt: z.string().datetime(),
  capturedAt: z.string().datetime().optional(),
});

export const protocolEnvelopeSchema = z.object({
  protocol: commerceProtocolSchema,
  version: z.string().min(1),
  messageType: z.string().min(1),
  messageId: z.string().min(1),
  createdAt: z.string().datetime(),
});

export const checkoutBindingInputSchema = z.object({
  checkoutId: z.string().min(1),
  merchantId: z.string().min(1),
  quoteId: z.string().min(1),
  currency: z.literal("INR"),
  totalPaise: z.number().int().nonnegative(),
  lineItems: merchantOfferSchema.shape.items,
  expiresAt: z.string().datetime(),
});

export type CommerceIntentInput = z.infer<typeof commerceIntentSchema>;
export type MerchantOfferInput = z.infer<typeof merchantOfferSchema>;
export type CheckoutSessionInput = z.infer<typeof checkoutSessionSchema>;
export type UserMandateInput = z.infer<typeof userMandateSchema>;
export type SignedUserMandateInput = z.infer<typeof signedUserMandateSchema>;
export type CheckoutMandateInput = z.infer<typeof checkoutMandateSchema>;
export type PaymentMandateInput = z.infer<typeof paymentMandateSchema>;
export type PaymentAuthorizationInput = z.infer<typeof paymentAuthorizationSchema>;
export type PaymentReceiptInput = z.infer<typeof paymentReceiptSchema>;
