import { NextResponse } from "next/server";
import { protocolRegistry, protocolSummary, resolveProtocol, type ProtocolTarget } from "@mandate/shared";

const GATEWAY_INTERNAL_URL = (process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");
const MCP_INTERNAL_URL = (process.env.MCP_INTERNAL_URL ?? "http://localhost:4100").replace(/\/$/, "");
const MCP_AGENT_TOKEN = process.env.MCP_AGENT_TOKEN ?? "";
const X402_INTERNAL_URL = (process.env.X402_SERVICE_INTERNAL_URL ?? "http://localhost:4021").replace(/\/$/, "");

async function probeJson(url: string): Promise<{ ok: boolean; status: number; detail: string }> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    return { ok: response.ok, status: response.status, detail: typeof body?.status === "string" ? body.status : `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, status: 0, detail: error instanceof Error ? error.message : "UNAVAILABLE" };
  }
}

async function probeMcp(): Promise<{ ok: boolean; status: number; detail: string }> {
  if (!MCP_AGENT_TOKEN) return { ok: false, status: 0, detail: "MCP_AGENT_TOKEN_NOT_CONFIGURED" };
  try {
    const response = await fetch(`${MCP_INTERNAL_URL}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${MCP_AGENT_TOKEN}`,
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "server/discover",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: "phase-12-discover", method: "server/discover" }),
      cache: "no-store",
    });
    const body = await response.json().catch(() => null) as { result?: { serverInfo?: { name?: string }; protocolVersion?: string }; error?: { message?: string } } | null;
    return { ok: response.ok && Boolean(body?.result?.protocolVersion), status: response.status, detail: body?.result?.protocolVersion ? `MCP ${body.result.protocolVersion} · ${body.result.serverInfo?.name ?? "server"}` : body?.error?.message ?? `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, status: 0, detail: error instanceof Error ? error.message : "MCP_UNAVAILABLE" };
  }
}

async function probeX402(): Promise<{ ok: boolean; status: number; detail: string }> {
  try {
    const response = await fetch(`${X402_INTERNAL_URL}/resource`, { cache: "no-store" });
    const challenge = response.headers.get("payment-required") ?? response.headers.get("PAYMENT-REQUIRED") ?? "";
    return { ok: response.status === 402 && Boolean(challenge), status: response.status, detail: response.status === 402 ? "HTTP 402 · PAYMENT-REQUIRED challenge observed" : `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, status: 0, detail: error instanceof Error ? error.message : "X402_UNAVAILABLE" };
  }
}

async function collectLive() {
  const [gateway, mcp, x402] = await Promise.all([
    probeJson(`${GATEWAY_INTERNAL_URL}/health`),
    probeMcp(),
    probeX402(),
  ]);
  return {
    "mandate-native": gateway,
    mcp,
    x402,
    acp: { ok: false, status: 0, detail: "adapter-target" },
    ap2: { ok: false, status: 0, detail: "semantic-alignment" },
    uap: { ok: false, status: 0, detail: "research-adapter-ready" },
  } as const;
}

export async function GET() {
  const live = await collectLive();
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    summary: protocolSummary(),
    protocols: protocolRegistry.map((protocol) => ({ ...protocol, live: live[protocol.id] })),
    routes: {
      "merchant-checkout": resolveProtocol("merchant-checkout"),
      "agent-service": resolveProtocol("agent-service"),
      "tool-payment": resolveProtocol("tool-payment"),
      "delegated-upi": resolveProtocol("delegated-upi"),
    },
    architecture: [
      "Agent / Model",
      "Protocol adapter",
      "MANDATE policy core",
      "Payment rail",
    ],
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { target?: unknown; probe?: unknown } | null;
  const target = typeof body?.target === "string" ? body.target as ProtocolTarget : null;
  if (!target || !["merchant-checkout", "agent-service", "tool-payment", "delegated-upi"].includes(target)) {
    return NextResponse.json({ error: "INVALID_PROTOCOL_TARGET" }, { status: 400 });
  }

  try {
    const selected = resolveProtocol(target);
    const reference = protocolRegistry.find((protocol) => protocol.id === (target === "delegated-upi" ? "uap" : selected.id));
    let trace: { ok: boolean; status: number; detail: string } | null = null;
    if (body?.probe === true) {
      if (selected.id === "mcp") trace = await probeMcp();
      else if (selected.id === "x402") trace = await probeX402();
      else trace = await probeJson(`${GATEWAY_INTERNAL_URL}/health`);
    }
    return NextResponse.json({
      target,
      selected,
      boundary: {
        authority: "MANDATE policy core remains the execution authority",
        modelControlsAmount: false,
        modelControlsPaymentSecret: false,
        execution: selected.demoEnabled ? "available-in-demo" : "not-executable",
      },
      referenceProtocol: reference ?? selected,
      trace,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "PROTOCOL_ROUTE_UNAVAILABLE" }, { status: 409 });
  }
}
