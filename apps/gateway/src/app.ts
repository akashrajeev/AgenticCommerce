import { createHealthStatus } from "@mandate/shared";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "./config.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: [config.buyerAppOrigin, config.merchantAppOrigin],
    }),
  );
  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json(createHealthStatus("gateway"));
  });

  app.get("/", (_request, response) => {
    response.json({
      name: "MANDATE Gateway",
      role: "deterministic policy, transaction, Razorpay, webhook, and audit boundary",
      status: "foundation-ready",
    });
  });

  return app;
}
