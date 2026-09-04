import { NextResponse } from "next/server";

const MCP_INTERNAL_URL = (process.env.MCP_INTERNAL_URL ?? "http://localhost:4100").replace(/\/$/, "");
const MCP_AGENT_TOKEN = process.env.MCP_AGENT_TOKEN ?? "";
const GATEWAY_INTERNAL_URL = (process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");
const MERCHANT_INTERNAL_URL = (process.env.MERCHANT_INTERNAL_URL ?? "http://localhost:3000").replace(/\/$/, "");
const INTERNAL_GATEWAY_SECRET = process.env.INTERNAL_GATEWAY_SECRET ?? "mandate-local-gateway";

const modernHeaders = (method: string, toolName?: string): HeadersInit => ({
  "content-type": "application/json",
  authorization: `Bearer ${MCP_AGENT_TOKEN}`,
  "mcp-protocol-version": "2026-07-28",
  "mcp-method": method,
  ...(toolName ? { "mcp-name": toolName } : {}),
});

async function callMcp(body: unknown, headers: HeadersInit): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetch(`${MCP_INTERNAL_URL}/mcp`, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch (error) {
    return { status: 502, body: { error: error instanceof Error ? error.message : "MCP_UNAVAILABLE" } };
  }
}

async function jsonRequest(url: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> | null }> {
  try {
    const response = await fetch(url, { ...init, cache: "no-store" });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    return { status: response.status, body };
  } catch (error) {
    return { status: 502, body: { error: error instanceof Error ? error.message : "INTERNAL_REQUEST_FAILED" } };
  }
}

async function latestTransaction(): Promise<Record<string, unknown> | null> {
  const request = await jsonRequest(`${GATEWAY_INTERNAL_URL}/v1/transactions`, { method: "GET" });
  if (request.status >= 400 || !request.body) return null;
  const raw = request.body.transactions;
  const transactions = Array.isArray(raw) ? raw.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object")) : [];
  return transactions[transactions.length - 1] ?? null;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  const action = typeof body?.action === "string" ? body.action : "";

  if (action === "unauthorized") {
    return NextResponse.json(await callMcp(
      { jsonrpc: "2.0", id: "lab-unauthorized", method: "tools/list" },
      { "content-type": "application/json", "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/list" },
    ));
  }

  if (action === "auth-boundary") {
    const [unauthorized, authorized] = await Promise.all([
      callMcp(
        { jsonrpc: "2.0", id: "lab-boundary-unauthorized", method: "tools/list" },
        { "content-type": "application/json", "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/list" },
      ),
      callMcp(
        { jsonrpc: "2.0", id: "lab-boundary-authorized", method: "tools/list" },
        modernHeaders("tools/list"),
      ),
    ]);
    return NextResponse.json({
      scenario: "MCP_AUTH_BOUNDARY_PROOF",
      expected: { unauthenticated: 401, authenticated: 200 },
      unauthorized,
      authorized,
      proof: unauthorized.status === 401 && authorized.status === 200 ? "AUTHENTICATION_BOUNDARY_CONFIRMED" : "AUTHENTICATION_BOUNDARY_NOT_CONFIRMED",
    });
  }

  if (action === "discover") {
    return NextResponse.json(await callMcp(
      { jsonrpc: "2.0", id: "lab-discover", method: "server/discover", params: { _meta: { "io.modelcontextprotocol/clientInfo": { name: "mandate-buyer-lab", version: "1.0" } } } },
      modernHeaders("server/discover"),
    ));
  }

  if (action === "tools") {
    return NextResponse.json(await callMcp(
      { jsonrpc: "2.0", id: "lab-tools", method: "tools/list" },
      modernHeaders("tools/list"),
    ));
  }

  if (action === "explain") {
    const candidate = await latestTransaction();
    if (!candidate || typeof candidate.id !== "string") {
      return NextResponse.json({ status: 412, body: { error: "NO_TRANSACTION_TO_EXPLAIN", next: "Run the flagship negotiation flow first; this read-only proof reuses that real gateway transaction." } });
    }
    return NextResponse.json({
      scenario: "READ_ONLY_MCP_EXPLANATION",
      transactionId: candidate.id,
      ...await callMcp(
        { jsonrpc: "2.0", id: `lab-explain-${candidate.id}`, method: "tools/call", params: { name: "mandate_razorpay_explain_transaction", arguments: { transactionId: candidate.id } } },
        modernHeaders("tools/call", "mandate_razorpay_explain_transaction"),
      ),
      proof: "READ_ONLY_NO_PAYMENT_SIDE_EFFECT",
    });
  }

  if (action === "guard") {
    const quoteRequest = await jsonRequest(`${MERCHANT_INTERNAL_URL}/api/agent/checkout/preview`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-mandate-gateway-secret": INTERNAL_GATEWAY_SECRET },
      body: JSON.stringify({ lineItems: [{ productId: "hp-001", quantity: 1 }] }),
    });
    const quote = quoteRequest.body?.quote as { quoteId?: unknown; merchantId?: unknown; totalPaise?: unknown; lineItems?: unknown; currency?: unknown; expiresAt?: unknown } | undefined;
    if (quoteRequest.status >= 400 || !quote || typeof quote.quoteId !== "string" || typeof quote.merchantId !== "string" || typeof quote.totalPaise !== "number" || !Array.isArray(quote.lineItems) || quote.currency !== "INR" || typeof quote.expiresAt !== "string") {
      return NextResponse.json({ status: quoteRequest.status, body: quoteRequest.body ?? { error: "MCP_GUARD_QUOTE_FAILED" } });
    }

    const transactionRequest = await jsonRequest(`${GATEWAY_INTERNAL_URL}/v1/purchase-intents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        merchantId: quote.merchantId,
        productId: "hp-001",
        quantity: 1,
        lineItems: [{ productId: "hp-001", quantity: 1 }],
        maxSpendPaise: quote.totalPaise,
        reason: "MCP policy guard security simulation",
        quoteId: quote.quoteId,
      }),
    });
    const transaction = transactionRequest.body?.transaction as { id?: unknown } | undefined;
    if (transactionRequest.status >= 400 || !transaction || typeof transaction.id !== "string") {
      return NextResponse.json({ status: transactionRequest.status, body: transactionRequest.body ?? { error: "MCP_GUARD_TRANSACTION_FAILED" } });
    }

    return NextResponse.json({
      scenario: "SECURITY_SIMULATION",
      transactionId: transaction.id,
      ...await callMcp(
        {
          jsonrpc: "2.0",
          id: "lab-guard",
          method: "tools/call",
          params: {
            name: "mandate_razorpay_capture_payment",
            arguments: { authorizationId: "demo-missing-authorization", transactionId: transaction.id, paymentId: "demo-payment" },
          },
        },
        modernHeaders("tools/call", "mandate_razorpay_capture_payment"),
      ),
    });
  }

  if (action === "authorized-test-order") {
    const transactionsRequest = await jsonRequest(`${GATEWAY_INTERNAL_URL}/v1/transactions`, { method: "GET" });
    const raw = transactionsRequest.body?.transactions;
    const transactions = Array.isArray(raw) ? raw.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object")) : [];
    const candidate = transactions.find((value) => {
      const mandateAuthorization = value.mandateAuthorization;
      return value.state === "policy_authorized" && mandateAuthorization && typeof mandateAuthorization === "object" && (mandateAuthorization as Record<string, unknown>).status === "authorized" && typeof (mandateAuthorization as Record<string, unknown>).authorizationId === "string";
    });
    if (!candidate) {
      return NextResponse.json({ status: 412, body: { error: "NO_AUTHORIZED_MANDATE_TRANSACTION", next: "Run the flagship /negotiation flow through mandate authorization first; this demo will then reuse that real transaction." } });
    }

    const mandateAuthorization = candidate.mandateAuthorization as Record<string, unknown>;
    const authorizationId = String(mandateAuthorization.authorizationId);
    const transactionId = String(candidate.id);
    const result = await callMcp(
      {
        jsonrpc: "2.0",
        id: `lab-authorized-${transactionId}`,
        method: "tools/call",
        params: {
          name: "mandate_razorpay_create_order",
          arguments: { authorizationId, transactionId },
        },
      },
      modernHeaders("tools/call", "mandate_razorpay_create_order"),
    );

    return NextResponse.json({
      scenario: "REAL_RAZORPAY_TEST_MODE_AUTHORIZED",
      transactionId,
      authorizationId,
      ...result,
      proof: result.status >= 200 && result.status < 300 ? "AUTHORIZED_MCP_REQUEST_REACHED_RAZORPAY_TEST_MODE" : "AUTHORIZED_MCP_REQUEST_FAILED",
    });
  }

  return NextResponse.json({ error: "INVALID_MCP_LAB_ACTION" }, { status: 400 });
}
