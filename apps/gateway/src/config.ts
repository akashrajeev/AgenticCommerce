import "dotenv/config";

const production = process.env.NODE_ENV === "production";

export const config = {
  port: Number.parseInt(process.env.PORT ?? "4000", 10),
  databaseUrl: process.env.DATABASE_URL ?? "",
  buyerAppOrigin: process.env.BUYER_APP_ORIGIN ?? "http://localhost:3001",
  merchantAppOrigin: process.env.MERCHANT_APP_ORIGIN ?? "http://localhost:3000",
  merchantInternalUrl: process.env.MERCHANT_INTERNAL_URL ?? process.env.MERCHANT_APP_ORIGIN ?? "http://localhost:3000",
  maxQuantity: Number.parseInt(process.env.MAX_QUANTITY ?? "5", 10),
  internalGatewaySecret: process.env.INTERNAL_GATEWAY_SECRET ?? "mandate-local-gateway",
  tenantAuthRequired: process.env.TENANT_AUTH_REQUIRED === undefined ? production : process.env.TENANT_AUTH_REQUIRED === "true",
  tenantApiKeysJson: process.env.MANDATE_TENANT_API_KEYS ?? "",
  razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? "",
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET ?? "",
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
  razorpayBaseUrl: process.env.RAZORPAY_BASE_URL ?? "https://api.razorpay.com/v1",
};
