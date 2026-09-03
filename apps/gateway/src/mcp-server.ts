import { timingSafeEqual } from "node:crypto";
import express, { type Request } from "express";
import { config } from "./config.js";
import { fetchOrder, fetchPayment } from "./razorpay.js";

const app = express();
const port = Number.parseInt(process.env.MCP_PORT ?? "4100", 10);
const mcpToken = process.env.MCP_AGENT_TOKEN ?? "";
const gatewayBaseUrl = (process.env.MCP_GATEWAY_INTERNAL_URL ?? `http://127.0.0.1:${config.port}`).replace(/\/$/, "");
const protocolVersions = new Set(["2025-06-18", "2025-11-25", "2026-07-28"]);

const tools = [
  {
    name: "mandate_razorpay_create_order",
    description: "Create a Razorpay order only for an already authorized MANDATE transaction. Never provide an amount from the model; the gateway transaction remains authoritative.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        authorizationId: { type: "string", description: "Trusted MANDATE authorization ID." },
        transactionId: { type: "string", description: "Trusted gateway transaction ID bound to the authorization." },
      },
      required: ["authorizationId", "transactionId"],
    },
  },
  {
    name: "mandate_razorpay_fetch_order",
    description: "Read a Razorpay order after proving it belongs to a MANDATE transaction.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { transactionId: { type: "string" }, orderId: { type: "string" } },
      required: ["transactionId", "orderId"],
    },
  },
  {
    name: "mandate_razorpay_fetch_payment",
    description: "Read a Razorpay payment after proving it belongs to a MANDATE transaction.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { transactionId: { type: "string" }, paymentId: { type: "string" } },
      required: ["transactionId", "paymentId"],
    },
  },
  {
    name: "mandate_razorpay_capture_payment",
    description: "Capture a Razorpay payment through the existing gateway transaction boundary. A valid MANDATE authorization and matching transaction are mandatory.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        authorizationId: { type: "string", description: "Trusted MANDATE authorization ID." },
        transactionId: { type: "string", description: "Trusted gateway transaction ID." },
        paymentId: { type: "string", description: "Razorpay payment ID returned by Checkout." },
      },
      required: ["authorizationId", "transactionId", "paymentId"],
    },
  },
];

function jsonRpc(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: unknown, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function secureEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  } catch {
    return false;
  }
}

function authorizedRequest(request: Request): boolean {
  if (!mcpToken) return process.env.NODE_ENV !== "production";
  const header = request.header("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  return secureEqual(header.slice("Bearer ".length), mcpToken);
}

function asArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_TOOL_ARGUMENTS");
  return value as Record<string, unknown>;
}

function requiredString(args: Record<string, unknown>, field: string): string {
  const value = args[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(`INVALID_${field.toUpperCase()}`);
  return value.trim();
}

async function gateway(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("x-mandate-gateway-secret", config.internalGatewaySecret);
  return fetch(`${gatewayBaseUrl}${path}`, { ...init, headers, cache: "no-store" });
}

async function gatewayJson(path: string, init?: RequestInit) {
  const response = await gateway(path, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body && typeof body === "object" && typeof (body as Record<string, unknown>).error === "string"
      ? String((body as Record<string, unknown>).error)
      : `GATEWAY_HTTP_${response.status}`;
    throw new Error(error);
  }
  return body;
}

function findTransaction(transactionsBody: unknown, transactionId: string): Record<string, unknown> {
  const transactions = transactionsBody && typeof transactionsBody === "object" && Array.isArray((transactionsBody as Record<string, unknown>).transactions)
    ? (transactionsBody as Record<string, unknown>).transactions
    : [];
  const transaction = transactions.find((item: unknown) => item && typeof item === "object" && (item as Record<string, unknown>).id === transactionId);
  if (!transaction || typeof transaction !== "object") throw new Error("TRANSACTION_NOT_FOUND");
  return transaction as Record<string, unknown>;
}

function assertTransactionBinding(transaction: Record<string, unknown>, transactionId: string, authorizationId?: string): void {
  if (transaction.id !== transactionId) throw new Error("TRANSACTION_BINDING_MISMATCH");
  if (authorizationId !== undefined) {
    const mandateAuthorization = transaction.mandateAuthorization;
    if (!mandateAuthorization || typeof mandateAuthorization !== "object") throw new Error("MANDATE_AUTHORIZATION_REQUIRED");
    if ((mandateAuthorization as Record<string, unknown>).authorizationId !== authorizationId) throw new Error("MANDATE_AUTHORIZATION_MISMATCH");
    if ((mandateAuthorization as Record<string, unknown>).status !== "authorized") throw new Error("MANDATE_AUTHORIZATION_NOT_ACTIVE");
  }
}

async function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "mandate_razorpay_create_order": {
      const authorizationId = requiredString(args, "authorizationId");
      const transactionId = requiredString(args, "transactionId");
      return gatewayJson(`/v1/mandates/${encodeURIComponent(authorizationId)}/razorpay-order`, {
        method: "POST",
        body: JSON.stringify({ transactionId }),
      });
    }
    case "mandate_razorpay_fetch_order": {
      const transactionId = requiredString(args, "transactionId");
      const orderId = requiredString(args, "orderId");
      const body = await gatewayJson("/v1/transactions");
      const transaction = findTransaction(body, transactionId);
      assertTransactionBinding(transaction, transactionId);
      if (transaction.razorpayOrderId !== orderId) throw new Error("RAZORPAY_ORDER_BINDING_MISMATCH");
      return await fetchOrder(orderId);
    }
    case "mandate_razorpay_fetch_payment": {
      const transactionId = requiredString(args, "transactionId");
      const paymentId = requiredString(args, "paymentId");
      const body = await gatewayJson("/v1/transactions");
      const transaction = findTransaction(body, transactionId);
      assertTransactionBinding(transaction, transactionId);
      if (transaction.razorpayPaymentId !== paymentId) throw new Error("RAZORPAY_PAYMENT_BINDING_MISMATCH");
      return await fetchPayment(paymentId);
    }
    case "mandate_razorpay_capture_payment": {
      const authorizationId = requiredString(args, "authorizationId");
      const transactionId = requiredString(args, "transactionId");
      const paymentId = requiredString(args, "paymentId");
      const body = await gatewayJson("/v1/transactions");
      const transaction = findTransaction(body, transactionId);
      assertTransactionBinding(transaction, transactionId, authorizationId);
      if (transaction.razorpayPaymentId && transaction.razorpayPaymentId !== paymentId) throw new Error("RAZORPAY_PAYMENT_BINDING_MISMATCH");
      return gatewayJson(`/v1/transactions/${encodeURIComponent(transactionId)}/capture`, {
        method: "POST",
        body: JSON.stringify({ paymentId, amountPaise: transaction.quote && typeof transaction.quote === "object" ? (transaction.quote as Record<string, unknown>).totalPaise : undefined }),
      });
    }
    default:
      throw new Error("TOOL_NOT_FOUND");
  }
}

app.use(express.json({ limit: "64kb" }));
app.use((request, response, next) => {
  if (!isLocalOrigin(request.header("origin"))) return response.status(403).json({ error: "INVALID_MCP_ORIGIN" });
  if (!authorizedRequest(request)) return response.status(401).json({ error: "UNAUTHORIZED_MCP_CLIENT" });
  next();
});

app.get("/health", (_request, response) => response.json({ app: "mandate-mcp", status: "ok", transport: "streamable-http", protocolVersions: [...protocolVersions] }));

app.post("/mcp", async (request, response) => {
  const message = request.body as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown } | null;
  const id = message?.id ?? null;
  if (message?.jsonrpc !== "2.0" || typeof message.method !== "string") return response.status(400).json(jsonRpcError(id, -32600, "Invalid Request"));

  const protocolVersion = request.header("mcp-protocol-version") ?? (message.params && typeof message.params === "object" ? ((message.params as Record<string, unknown>)._meta as Record<string, unknown> | undefined)?.["io.modelcontextprotocol/protocolVersion"] as string | undefined : undefined);
  if (protocolVersion && !protocolVersions.has(protocolVersion)) return response.status(400).json(jsonRpcError(id, -32602, "Unsupported MCP protocol version", { supported: [...protocolVersions] }));

  try {
    if (message.method === "initialize") {
      return response.json(jsonRpc(id, {
        protocolVersion: protocolVersion ?? "2026-07-28",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "MANDATE Razorpay MCP Policy Gateway", version: "0.1.0" },
      }));
    }
    if (message.method === "tools/list") return response.json(jsonRpc(id, { tools }));
    if (message.method === "tools/call") {
      const params = message.params && typeof message.params === "object" ? message.params as Record<string, unknown> : {};
      const name = typeof params.name === "string" ? params.name : "";
      if (!name) return response.json(jsonRpcError(id, -32602, "Tool name is required"));
      const result = await callTool(name, asArgs(params.arguments ?? {}));
      return response.json(jsonRpc(id, { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result }));
    }
    return response.json(jsonRpcError(id, -32601, `Method not found: ${message.method}`));
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "MCP_TOOL_FAILED";
    return response.json(jsonRpc(id, { content: [{ type: "text", text: messageText }], isError: true }));
  }
});

app.listen(port, () => console.log(`MANDATE MCP policy gateway listening on http://127.0.0.1:${port}/mcp`));
