import { NextResponse } from "next/server";

const MCP_INTERNAL_URL = (process.env.MCP_INTERNAL_URL ?? "http://localhost:4100").replace(/\/$/, "");
const MCP_AGENT_TOKEN = process.env.MCP_AGENT_TOKEN ?? "";

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
    return NextResponse.json(await callMcp(
      {
        jsonrpc: "2.0",
        id: "lab-guard",
        method: "tools/call",
        params: {
          name: "mandate_razorpay_capture_payment",
          arguments: { transactionId: "demo-unbound-transaction", paymentId: "demo-payment" },
        },
      },
      modernHeaders("tools/call", "mandate_razorpay_capture_payment"),
    ));
  }

  return NextResponse.json({ error: "INVALID_MCP_LAB_ACTION" }, { status: 400 });
}
