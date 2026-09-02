import type { PurchaseIntent } from "@mandate/types";
import { createHealthStatus } from "@mandate/shared";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "./config.js";
import {
  getTimeline,
  getTransaction,
  proposeTransaction,
} from "./transaction-core.js";

function parsePurchaseIntent(body: unknown): Omit<PurchaseIntent, "id"> {
  if (!body || typeof body !== "object") throw new Error("INVALID_REQUEST");
  const input = body as Record<string, unknown>;

  const merchantId = typeof input.merchantId === "string" ? input.merchantId : "";
  const productId = typeof input.productId === "string" ? input.productId : "";
  const quoteId = typeof input.quoteId === "string" ? input.quoteId : "";
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const quantity = typeof input.quantity === "number" ? input.quantity : NaN;
  const maxSpendPaise = typeof input.maxSpendPaise === "number" ? input.maxSpendPaise : NaN;

  if (!merchantId || !productId || !quoteId || !reason) throw new Error("INVALID_REQUEST");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > config.maxQuantity) {
    throw new Error("INVALID_QUANTITY");
  }
  if (!Number.isInteger(maxSpendPaise) || maxSpendPaise < 0) {
    throw new Error("INVALID_SPEND_LIMIT");
  }

  return { merchantId, productId, quoteId, reason, quantity, maxSpendPaise };
}

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: [config.buyerAppOrigin, config.merchantAppOrigin],
    }),
  );
  app.use(express.json({ limit: "32kb" }));

  app.get("/health", (_request, response) => {
    response.json(createHealthStatus("gateway"));
  });

  app.get("/", (_request, response) => {
    response.json({
      name: "MANDATE Gateway",
      role: "deterministic policy, transaction, Razorpay, webhook, and audit boundary",
      status: "transaction-core-ready",
    });
  });

  app.post("/v1/purchase-intents", async (request, response) => {
    try {
      const input = parsePurchaseIntent(request.body);
      const transaction = await proposeTransaction(input);
      response.status(201).json({ transaction });
    } catch (error) {
      const message = error instanceof Error ? error.message : "INVALID_REQUEST";
      const status = message === "INVALID_REQUEST" || message.startsWith("INVALID_") ? 400 : 422;
      response.status(status).json({ error: message });
    }
  });

  app.get("/v1/transactions/:id", (request, response) => {
    const transaction = getTransaction(request.params.id);
    if (!transaction) return response.status(404).json({ error: "TRANSACTION_NOT_FOUND" });
    return response.json({ transaction });
  });

  app.get("/v1/transactions/:id/timeline", (request, response) => {
    if (!getTransaction(request.params.id)) return response.status(404).json({ error: "TRANSACTION_NOT_FOUND" });
    return response.json({ events: getTimeline(request.params.id) });
  });

  return app;
}
