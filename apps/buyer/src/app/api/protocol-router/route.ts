import { NextResponse } from "next/server";
import { protocolRegistry, protocolSummary, resolveProtocol, type ProtocolTarget } from "@mandate/shared";

const GATEWAY_INTERNAL_URL = (process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");
const MCP_INTERNAL_URL = (process.env.MCP_INTERNAL_URL ?? "http://localhost:4100").replace(/\/$/, "");
const X402_INTERNAL_URL = (process.env.X402_SERVICE_INTERNAL_URL ?? "http://localhost:4021").replace(/\/$/, "");

async function probe(url: string): Promise<{ ok: boolean; status: number; detail: string }> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    return { ok: response.ok, status: response.status, detail: typeof body?.status === "string" ? body.status : `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, status: 0, detail: error instanceof Error ? error.message : "UNAVAILABLE" };
  }
}

export async function GET() {
  const [gateway, mcp, x402] = await Promise.all([
    probe(`${GATEWAY_INTERNAL_URL}/health`),
    probe(`${MCP_INTERNAL_URL}/health`),
    probe(`${X402_INTERNAL_URL}/health`),
  ]);

  const live = {
    "mandate-native": gateway,
    mcp,
    x402,
    acp: { ok: false, status: 0, detail: "adapter-target" },
    ap2: { ok: false, status: 0, detail: "semantic-alignment" },
    uap: { ok: false, status: 0, detail: "research-adapter-ready" },
  } as const;

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
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { target?: unknown } | null;
  const target = typeof body?.target === "string" ? body.target as ProtocolTarget : null;
  if (!target || !["merchant-checkout", "agent-service", "tool-payment", "delegated-upi"].includes(target)) {
    return NextResponse.json({ error: "INVALID_PROTOCOL_TARGET" }, { status: 400 });
  }

  try {
    const selected = resolveProtocol(target);
    const reference = protocolRegistry.find((protocol) => protocol.id === (target === "delegated-upi" ? "uap" : selected.id));
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
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "PROTOCOL_ROUTE_UNAVAILABLE" }, { status: 409 });
  }
}
