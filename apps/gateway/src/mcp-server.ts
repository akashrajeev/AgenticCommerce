import { timingSafeEqual } from "node:crypto";
import express, { type Request } from "express";
import { config } from "./config.js";

const app = express();
const port = Number.parseInt(process.env.MCP_PORT ?? "4100", 10);
const mcpToken = process.env.MCP_AGENT_TOKEN ?? "";
const gatewayBaseUrl = (process.env.MCP_GATEWAY_INTERNAL_URL ?? `http://127.0.0.1:${config.port}`).replace(/\/$/, "");
const protocolVersions = new Set(["2025-06-18", "2025-11-25", "2026-07-28"]);
const MODERN_PROTOCOL_VERSION = "2026-07-28";

const tools = [
  { name: "mandate_razorpay_create_order", description: "Create a Razorpay order only for an already authorized MANDATE transaction. Never provide an amount from the model; the gateway transaction remains authoritative.", inputSchema: { type: "object", additionalProperties: false, properties: { authorizationId: { type: "string" }, transactionId: { type: "string" }, campaignId: { type: "string", minLength: 1, maxLength: 40 } }, required: ["authorizationId", "transactionId"] } },
  { name: "mandate_razorpay_fetch_order", description: "Retrieve gateway-authoritative evidence for a Razorpay order after proving the order ID is bound to the supplied transaction.", inputSchema: { type: "object", additionalProperties: false, properties: { transactionId: { type: "string" }, orderId: { type: "string" } }, required: ["transactionId", "orderId"] } },
  { name: "mandate_razorpay_fetch_payment", description: "Retrieve gateway-authoritative evidence for a Razorpay payment after proving the payment ID is bound to the supplied transaction.", inputSchema: { type: "object", additionalProperties: false, properties: { transactionId: { type: "string" }, paymentId: { type: "string" } }, required: ["transactionId", "paymentId"] } },
  { name: "mandate_razorpay_capture_payment", description: "Capture a Razorpay payment through the existing gateway transaction boundary. A valid MANDATE authorization and matching transaction are mandatory.", inputSchema: { type: "object", additionalProperties: false, properties: { authorizationId: { type: "string" }, transactionId: { type: "string" }, paymentId: { type: "string" } }, required: ["authorizationId", "transactionId", "paymentId"] } },
  { name: "mandate_razorpay_verify_settlement", description: "Re-read the bound Razorpay order and payment from Razorpay Test Mode and prove amount, order binding, and captured-payment state before treating merchant revenue as payment-verified.", inputSchema: { type: "object", additionalProperties: false, properties: { transactionId: { type: "string" }, orderId: { type: "string" }, paymentId: { type: "string" } }, required: ["transactionId", "orderId", "paymentId"] } },
  { name: "mandate_razorpay_explain_transaction", description: "Read-only explanation of why a transaction is or is not payment-ready. Returns the authoritative intent, quote, mandate binding, policy checks and audit timeline without executing a payment.", inputSchema: { type: "object", additionalProperties: false, properties: { transactionId: { type: "string" } }, required: ["transactionId"] } },
];

function jsonRpc(id: unknown, result: unknown) { return { jsonrpc: "2.0", id, result }; }
function jsonRpcError(id: unknown, code: number, message: string, data?: unknown) { return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } }; }
function secureEqual(a: string, b: string): boolean { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
function isLocalOrigin(origin: string | undefined): boolean { if (!origin) return true; try { const url = new URL(origin); return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"; } catch { return false; } }
function authorizedRequest(request: Request): boolean { if (!mcpToken) return process.env.NODE_ENV !== "production"; const header = request.header("authorization") ?? ""; return header.startsWith("Bearer ") && secureEqual(header.slice("Bearer ".length), mcpToken); }
function asArgs(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_TOOL_ARGUMENTS"); return value as Record<string, unknown>; }
function asRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function requiredString(args: Record<string, unknown>, field: string): string { const value = args[field]; if (typeof value !== "string" || !value.trim()) throw new Error(`INVALID_${field.toUpperCase()}`); return value.trim(); }
async function gateway(path: string, init: RequestInit = {}) { const headers = new Headers(init.headers); headers.set("content-type", "application/json"); headers.set("x-mandate-gateway-secret", config.internalGatewaySecret); return fetch(`${gatewayBaseUrl}${path}`, { ...init, headers, cache: "no-store" }); }
async function gatewayJson(path: string, init?: RequestInit) { const response = await gateway(path, init); const body = await response.json().catch(() => null); if (!response.ok) { const error = body && typeof body === "object" && typeof (body as Record<string, unknown>).error === "string" ? String((body as Record<string, unknown>).error) : `GATEWAY_HTTP_${response.status}`; throw new Error(error); } return body; }
function findTransaction(transactionsBody: unknown, transactionId: string): Record<string, unknown> {
  const raw = transactionsBody && typeof transactionsBody === "object" ? (transactionsBody as Record<string, unknown>).transactions : undefined;
  const transactions = Array.isArray(raw) ? raw : [];
  const transaction = transactions.find((item: unknown) => item && typeof item === "object" && (item as Record<string, unknown>).id === transactionId);
  if (!transaction || typeof transaction !== "object") throw new Error("TRANSACTION_NOT_FOUND");
  return transaction as Record<string, unknown>;
}
function assertTransactionBinding(transaction: Record<string, unknown>, transactionId: string, authorizationId?: string): void { if (transaction.id !== transactionId) throw new Error("TRANSACTION_BINDING_MISMATCH"); if (authorizationId !== undefined) { const mandateAuthorization = transaction.mandateAuthorization; if (!mandateAuthorization || typeof mandateAuthorization !== "object") throw new Error("MANDATE_AUTHORIZATION_REQUIRED"); if ((mandateAuthorization as Record<string, unknown>).authorizationId !== authorizationId) throw new Error("MANDATE_AUTHORIZATION_MISMATCH"); if ((mandateAuthorization as Record<string, unknown>).status !== "authorized") throw new Error("MANDATE_AUTHORIZATION_NOT_ACTIVE"); } }
async function transactionEvidence(transactionId: string, transaction: Record<string, unknown>) { const timeline = await gatewayJson(`/v1/transactions/${encodeURIComponent(transactionId)}/timeline`, { method: "GET" }); return { transactionId, state: transaction.state, razorpayOrderId: transaction.razorpayOrderId ?? null, razorpayPaymentId: transaction.razorpayPaymentId ?? null, amount: transaction.quote && typeof transaction.quote === "object" ? (transaction.quote as Record<string, unknown>).totalPaise : null, currency: transaction.quote && typeof transaction.quote === "object" ? (transaction.quote as Record<string, unknown>).currency : null, timeline }; }
async function explainTransaction(transactionId: string): Promise<Record<string, unknown>> {
  const transaction = findTransaction(await gatewayJson("/v1/transactions"), transactionId);
  const intent = asRecord(transaction.intent);
  const quote = asRecord(transaction.quote);
  const policy = asRecord(transaction.policy);
  const authorization = asRecord(transaction.mandateAuthorization);
  const timeline = await gatewayJson(`/v1/transactions/${encodeURIComponent(transactionId)}/timeline`, { method: "GET" });
  const policyChecks = Array.isArray(policy?.checks) ? policy.checks : [];
  const authorizationBound = authorization?.status === "authorized" && typeof authorization.authorizationId === "string";
  const paymentReady = transaction.state === "policy_authorized" && authorizationBound;
  const blockers: string[] = [];
  if (transaction.state !== "policy_authorized") blockers.push(`TRANSACTION_STATE_${String(transaction.state ?? "unknown").toUpperCase()}`);
  if (!authorizationBound) blockers.push("MANDATE_AUTHORIZATION_REQUIRED");
  return {
    transactionId,
    explainable: true,
    paymentReady,
    blockers,
    intent: intent ? { merchantId: intent.merchantId ?? null, productId: intent.productId ?? null, quantity: intent.quantity ?? null, maxSpendPaise: intent.maxSpendPaise ?? null, reason: intent.reason ?? null } : null,
    quote: quote ? { quoteId: quote.quoteId ?? null, merchantId: quote.merchantId ?? null, totalPaise: quote.totalPaise ?? null, currency: quote.currency ?? null, expiresAt: quote.expiresAt ?? null, lineItems: quote.lineItems ?? [] } : null,
    policy: policy ? { decision: policy.decision ?? null, checks: policyChecks, evaluatedAt: policy.evaluatedAt ?? null } : null,
    mandateAuthorization: authorization ? { authorizationId: authorization.authorizationId ?? null, mandateId: authorization.mandateId ?? null, merchantId: authorization.merchantId ?? null, amount: authorization.amount ?? null, cartHash: authorization.cartHash ?? null, status: authorization.status ?? null, nonce: authorization.nonce ?? null, expiresAt: authorization.expiresAt ?? null } : null,
    razorpay: { orderId: transaction.razorpayOrderId ?? null, paymentId: transaction.razorpayPaymentId ?? null },
    timeline,
    authority: "MANDATE policy core remains the payment authority; this tool is read-only.",
  };
}
async function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "mandate_razorpay_create_order": { const authorizationId = requiredString(args, "authorizationId"); const transactionId = requiredString(args, "transactionId"); const campaignId = typeof args.campaignId === "string" ? args.campaignId.trim() : ""; return gatewayJson(`/v1/mandates/${encodeURIComponent(authorizationId)}/razorpay-order`, { method: "POST", body: JSON.stringify({ transactionId, ...(campaignId ? { campaignId } : {}) }) }); }
    case "mandate_razorpay_fetch_order": { const transactionId = requiredString(args, "transactionId"); const orderId = requiredString(args, "orderId"); const transaction = findTransaction(await gatewayJson("/v1/transactions"), transactionId); assertTransactionBinding(transaction, transactionId); if (transaction.razorpayOrderId !== orderId) throw new Error("RAZORPAY_ORDER_BINDING_MISMATCH"); return transactionEvidence(transactionId, transaction); }
    case "mandate_razorpay_fetch_payment": { const transactionId = requiredString(args, "transactionId"); const paymentId = requiredString(args, "paymentId"); const transaction = findTransaction(await gatewayJson("/v1/transactions"), transactionId); assertTransactionBinding(transaction, transactionId); if (transaction.razorpayPaymentId !== paymentId) throw new Error("RAZORPAY_PAYMENT_BINDING_MISMATCH"); return transactionEvidence(transactionId, transaction); }
    case "mandate_razorpay_capture_payment": { const authorizationId = requiredString(args, "authorizationId"); const transactionId = requiredString(args, "transactionId"); const paymentId = requiredString(args, "paymentId"); const transaction = findTransaction(await gatewayJson("/v1/transactions"), transactionId); assertTransactionBinding(transaction, transactionId, authorizationId); if (transaction.razorpayPaymentId && transaction.razorpayPaymentId !== paymentId) throw new Error("RAZORPAY_PAYMENT_BINDING_MISMATCH"); return gatewayJson(`/v1/transactions/${encodeURIComponent(transactionId)}/capture`, { method: "POST", body: JSON.stringify({ paymentId, amountPaise: transaction.quote && typeof transaction.quote === "object" ? (transaction.quote as Record<string, unknown>).totalPaise : undefined }) }); }
    case "mandate_razorpay_verify_settlement": {
      const transactionId = requiredString(args, "transactionId");
      const orderId = requiredString(args, "orderId");
      const paymentId = requiredString(args, "paymentId");
      const transaction = findTransaction(await gatewayJson("/v1/transactions"), transactionId);
      assertTransactionBinding(transaction, transactionId);
      if (transaction.razorpayOrderId !== orderId) throw new Error("RAZORPAY_ORDER_BINDING_MISMATCH");
      if (transaction.razorpayPaymentId !== paymentId) throw new Error("RAZORPAY_PAYMENT_BINDING_MISMATCH");
      const quote = transaction.quote && typeof transaction.quote === "object" ? transaction.quote as Record<string, unknown> : {};
      const expectedAmount = typeof quote.totalPaise === "number" ? quote.totalPaise : NaN;
      const [orderResponse, paymentResponse] = await Promise.all([gatewayJson(`/v1/internal/razorpay/orders/${encodeURIComponent(orderId)}`), gatewayJson(`/v1/internal/razorpay/payments/${encodeURIComponent(paymentId)}`)]);
      const order = (orderResponse as Record<string, unknown>).order as Record<string, unknown>;
      const payment = (paymentResponse as Record<string, unknown>).payment as Record<string, unknown>;
      const amountMatches = order.amount === expectedAmount && payment.amount === expectedAmount;
      const orderMatches = order.receipt === transactionId && payment.order_id === orderId;
      const captured = payment.status === "captured" && (order.status === "paid" || order.amount_paid === order.amount);
      if (!amountMatches) throw new Error("RAZORPAY_LIVE_AMOUNT_MISMATCH");
      if (!orderMatches) throw new Error("RAZORPAY_LIVE_BINDING_MISMATCH");
      if (!captured) throw new Error("RAZORPAY_LIVE_PAYMENT_NOT_CAPTURED");
      return { verified: true, testMode: true, transactionId, orderId, paymentId, amountPaise: expectedAmount, currency: payment.currency, order: { id: order.id, status: order.status, amount: order.amount, amountPaid: order.amount_paid, receipt: order.receipt, notes: order.notes }, payment: { id: payment.id, status: payment.status, amount: payment.amount, currency: payment.currency, orderId: payment.order_id, method: payment.method ?? null } };
    }
    case "mandate_razorpay_explain_transaction": return explainTransaction(requiredString(args, "transactionId"));
    default: throw new Error("TOOL_NOT_FOUND");
  }
}

app.use(express.json({ limit: "64kb" }));
app.get("/health", async (request, response) => {
  const gatewayStatus = await gatewayJson("/v1/internal/razorpay/status").catch(() => ({ testMode: false, configured: false }));
  const base = { app: "mandate-mcp", status: "ok", transport: "streamable-http", protocolVersions: [...protocolVersions], protocolVersion: MODERN_PROTOCOL_VERSION, razorpayTestMode: gatewayStatus && typeof gatewayStatus === "object" && "testMode" in gatewayStatus ? gatewayStatus.testMode === true : false };
  if (request.query.deep !== "1") return response.json(base);
  const started = Date.now();
  try {
    const probeResponse = await gatewayJson("/v1/internal/razorpay/status?deep=1", { method: "GET" });
    const probe = (probeResponse as Record<string, unknown>).probe as Record<string, unknown> | undefined;
    return response.json({ ...base, razorpayTestMode: (probeResponse as Record<string, unknown>).testMode === true, razorpayApiReachable: probe?.reachable === true, razorpayProbe: { ...(probe ?? {}), latencyMs: Date.now() - started } });
  } catch (error) {
    return response.status(503).json({ ...base, razorpayApiReachable: false, razorpayProbe: { reachable: false, testMode: base.razorpayTestMode, detail: error instanceof Error ? error.message : "RAZORPAY_API_PROBE_FAILED", latencyMs: Date.now() - started } });
  }
});
app.use((request, response, next) => { if (!isLocalOrigin(request.header("origin"))) return response.status(403).json({ error: "INVALID_MCP_ORIGIN" }); if (!authorizedRequest(request)) return response.status(401).json({ error: "UNAUTHORIZED_MCP_CLIENT" }); next(); });

app.post("/mcp", async (request, response) => {
  const message = request.body as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown } | null;
  const id = message?.id ?? null;
  if (message?.jsonrpc !== "2.0" || typeof message.method !== "string") return response.status(400).json(jsonRpcError(id, -32600, "Invalid Request"));
  const protocolVersion = (request.header("mcp-protocol-version") ?? "").trim();
  if (!protocolVersion || !protocolVersions.has(protocolVersion)) return response.status(400).json(jsonRpcError(id, -32602, "Unsupported or missing MCP protocol version", { supported: [...protocolVersions] }));

  if (protocolVersion === MODERN_PROTOCOL_VERSION) {
    const headerMethod = (request.header("mcp-method") ?? "").trim();
    if (!headerMethod || headerMethod !== message.method) return response.status(400).json(jsonRpcError(id, -32602, "Mcp-Method header must match the JSON-RPC method"));
    if (message.method === "tools/call") {
      const params = message.params && typeof message.params === "object" ? message.params as Record<string, unknown> : {};
      const name = typeof params.name === "string" ? params.name : "";
      const headerName = (request.header("mcp-name") ?? "").trim();
      if (!name || !headerName || headerName !== name) return response.status(400).json(jsonRpcError(id, -32602, "Mcp-Name header must match the tool name"));
    }
  }

  try {
    if (message.method === "server/discover") return response.json(jsonRpc(id, { protocolVersion: MODERN_PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "MANDATE Razorpay MCP Policy Gateway", version: "0.5.0" } }));
    if (message.method === "initialize") {
      if (protocolVersion === MODERN_PROTOCOL_VERSION) return response.json(jsonRpcError(id, -32601, "initialize is not supported in MCP 2026-07-28; use server/discover"));
      return response.json(jsonRpc(id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "MANDATE Razorpay MCP Policy Gateway", version: "0.5.0" } }));
    }
    if (message.method === "notifications/initialized") return protocolVersion === MODERN_PROTOCOL_VERSION ? response.status(204).end() : response.status(202).end();
    if (message.method === "ping") return response.json(jsonRpc(id, {}));
    if (message.method === "tools/list") return response.json(jsonRpc(id, { tools, ttlMs: 60_000, cacheScope: "private" }));
    if (message.method === "tools/call") { const params = message.params && typeof message.params === "object" ? message.params as Record<string, unknown> : {}; const name = typeof params.name === "string" ? params.name : ""; if (!name) return response.json(jsonRpcError(id, -32602, "Tool name is required")); const result = await callTool(name, asArgs(params.arguments ?? {})); return response.json(jsonRpc(id, { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result })); }
    return response.json(jsonRpcError(id, -32601, `Method not found: ${message.method}`));
  } catch (error) { const messageText = error instanceof Error ? error.message : "MCP_TOOL_FAILED"; return response.json(jsonRpc(id, { content: [{ type: "text", text: messageText }], isError: true })); }
});

app.listen(port, () => console.log(`MANDATE MCP policy gateway listening on http://127.0.0.1:${port}/mcp`));