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

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  const action = typeof body?.action === "string" ? body.action : "";

  if (action === "unauthorized") {
    return NextResponse.json(await callMcp(
      { jsonrpc: "2.0", id: "lab-unauthorized", method: "tools/list" },
      { "content-type": "application/json", "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/list" },
    ));
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

  return NextResponse.json({ error: "INVALID_MCP_LAB_ACTION" }, { status: 400 });
}
