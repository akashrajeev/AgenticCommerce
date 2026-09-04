import type { AppName, HealthStatus } from "@mandate/types";

export function createHealthStatus(app: AppName): HealthStatus {
  return {
    app,
    status: "ok",
    timestamp: new Date().toISOString(),
  };
}

export * from "./protocol-registry.js";
export * from "./intent-planner.js";
