import "dotenv/config";

export const config = {
  port: Number.parseInt(process.env.PORT ?? "4000", 10),
  buyerAppOrigin: process.env.BUYER_APP_ORIGIN ?? "http://localhost:3001",
  merchantAppOrigin: process.env.MERCHANT_APP_ORIGIN ?? "http://localhost:3000",
};
