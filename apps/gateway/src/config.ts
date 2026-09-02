import "dotenv/config";

export const config = {
  port: Number.parseInt(process.env.PORT ?? "4000", 10),
  buyerAppOrigin: process.env.BUYER_APP_ORIGIN ?? "http://localhost:3001",
  merchantAppOrigin: process.env.MERCHANT_APP_ORIGIN ?? "http://localhost:3000",
  maxQuantity: Number.parseInt(process.env.MAX_QUANTITY ?? "5", 10),
  internalGatewaySecret: process.env.INTERNAL_GATEWAY_SECRET ?? "mandate-local-gateway",
  razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? "",
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET ?? "",
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
  razorpayBaseUrl: process.env.RAZORPAY_BASE_URL ?? "https://api.razorpay.com/v1",
};
