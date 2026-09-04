import { NextResponse } from "next/server";
import { protocolRegistry, protocolSummary, resolveProtocol, type ProtocolTarget } from "@mandate/shared";

const GATEWAY_INTERNAL_URL = (process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");
const MCP_INTERNAL_URL = (process.env.MCP_INTERNAL_URL ?? "http://localhost:4100").replace(/\/$/, "");
const MCP_AGENT_TOKEN = process.env.MCP_AGENT_TOKEN ?? "";
const X402_INTERNAL_URL = (process.env.X402_SERVICE_INTERNAL_URL ?? "http://localhost:4021").replace(/\/$/, "");

type Probe = { ok: boolean; status: number; detail: string };

async function probeJson(url: string): Promise<Probe> {
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    return { ok: response.ok, status: response.status, detail: typeof body?.status === "string" ? body.status : `HTTP ${response.status}` };
  } catch (error) { return { ok: false, status: 0, detail: error instanceof Error ? error.message : "UNAVAILABLE" }; }
}

async function probeMcp(): Promise<Probe> {
  if (!MCP_AGENT_TOKEN) return { ok: false, status: 0, detail: "MCP_AGENT_TOKEN_NOT_CONFIGURED" };
  try {
    const common = { "content-type": "application/json", authorization: `Bearer ${MCP_AGENT_TOKEN}`, "mcp-protocol-version": "2026-07-28" };
    const health = await fetch(`${MCP_INTERNAL_URL}/health?deep=1`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    const healthBody = await health.json().catch(() => null) as { razorpayTestMode?: unknown; razorpayApiReachable?: unknown; razorpayProbe?: { detail?: unknown; latencyMs?: unknown } } | null;
    if (!health.ok || healthBody?.razorpayTestMode !== true || healthBody?.razorpayApiReachable !== true) {
      const detail = typeof healthBody?.razorpayProbe?.detail === "string" ? healthBody.razorpayProbe.detail : healthBody?.razorpayTestMode !== true ? "Razorpay Test Mode attestation failed" : "Razorpay Test API unreachable";
      return { ok: false, status: health.status, detail };
    }

    const discover = await fetch(`${MCP_INTERNAL_URL}/mcp`, { method: "POST", headers: { ...common, "mcp-method": "server/discover" }, body: JSON.stringify({ jsonrpc: "2.0", id: "probe-discover", method: "server/discover" }), cache: "no-store", signal: AbortSignal.timeout(4000) });
    const discoverBody = await discover.json().catch(() => null) as { result?: { protocolVersion?: string }; error?: { message?: string } } | null;
    if (!discover.ok || !discoverBody?.result?.protocolVersion) return { ok: false, status: discover.status, detail: discoverBody?.error?.message ?? `HTTP ${discover.status}` };
    const tools = await fetch(`${MCP_INTERNAL_URL}/mcp`, { method: "POST", headers: { ...common, "mcp-method": "tools/list" }, body: JSON.stringify({ jsonrpc: "2.0", id: "probe-tools", method: "tools/list" }), cache: "no-store", signal: AbortSignal.timeout(4000) });
    const toolsBody = await tools.json().catch(() => null) as { result?: { tools?: unknown[] }; error?: { message?: string } } | null;
    const count = Array.isArray(toolsBody?.result?.tools) ? toolsBody.result!.tools!.length : 0;
    const latency = typeof healthBody.razorpayProbe?.latencyMs === "number" ? ` · Razorpay API ${healthBody.razorpayProbe.latencyMs}ms` : "";
    return { ok: tools.ok && count > 0, status: tools.status, detail: `MCP ${discoverBody.result.protocolVersion} · ${count} guarded tools · Razorpay Test Mode API live${latency}` };
  } catch (error) { return { ok: false, status: 0, detail: error instanceof Error ? error.message : "MCP_UNAVAILABLE" }; }
}

async function probeX402(): Promise<Probe> {
  try {
    const [health, resource, facilitator] = await Promise.all([
      fetch(`${X402_INTERNAL_URL}/health`, { cache: "no-store", signal: AbortSignal.timeout(4000) }),
      fetch(`${X402_INTERNAL_URL}/resource`, { cache: "no-store", signal: AbortSignal.timeout(4000) }),
      fetch(`${X402_INTERNAL_URL}/facilitator-status`, { cache: "no-store", signal: AbortSignal.timeout(4000) }),
    ]);
    const healthBody = await health.json().catch(() => null) as Record<string, unknown> | null;
    const facilitatorBody = await facilitator.json().catch(() => null) as Record<string, unknown> | null;
    const challenge = resource.headers.get("payment-required") ?? resource.headers.get("PAYMENT-REQUIRED") ?? "";
    if (!health.ok) return { ok: false, status: health.status, detail: `x402 health HTTP ${health.status}` };
    if (resource.status === 402 && challenge && facilitatorBody?.reachable === true) return { ok: true, status: 402, detail: "HTTP 402 challenge · facilitator /supported live · settlement-ready" };
    if (resource.status === 402 && challenge) return { ok: false, status: 402, detail: "HTTP 402 challenge · facilitator unavailable" };
    if (resource.status === 503 && healthBody?.payToConfigured !== true) return { ok: false, status: 503, detail: "x402 service live · X402_PAY_TO not configured" };
    return { ok: false, status: resource.status, detail: `x402 resource HTTP ${resource.status}` };
  } catch (error) { return { ok: false, status: 0, detail: error instanceof Error ? error.message : "X402_UNAVAILABLE" }; }
}

async function collectLive() {
  const [gateway, mcp, x402] = await Promise.all([probeJson(`${GATEWAY_INTERNAL_URL}/health`), probeMcp(), probeX402()]);
  return { "mandate-native": gateway, mcp, x402, acp: { ok: false, status: 0, detail: "adapter-target" }, ap2: { ok: false, status: 0, detail: "semantic-alignment" }, uap: { ok: false, status: 0, detail: "research-adapter-ready" } } as const;
}

export async function GET() {
  const live = await collectLive();
  return NextResponse.json({ generatedAt: new Date().toISOString(), summary: protocolSummary(), protocols: protocolRegistry.map((protocol) => ({ ...protocol, live: live[protocol.id] })), routes: { "merchant-checkout": resolveProtocol("merchant-checkout"), "agent-service": resolveProtocol("agent-service"), "tool-payment": resolveProtocol("tool-payment"), "delegated-upi": resolveProtocol("delegated-upi") }, architecture: ["Agent / Model", "Protocol adapter", "MANDATE policy core", "Payment rail"] }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { target?: unknown; probe?: unknown } | null;
  const target = typeof body?.target === "string" ? body.target as ProtocolTarget : null;
  if (!target || !["merchant-checkout", "agent-service", "tool-payment", "delegated-upi"].includes(target)) return NextResponse.json({ error: "INVALID_PROTOCOL_TARGET" }, { status: 400 });
  try {
    const selected = resolveProtocol(target);
    const reference = protocolRegistry.find((protocol) => protocol.id === (target === "delegated-upi" ? "uap" : selected.id));
    let trace: Probe | null = null;
    if (body?.probe === true) trace = selected.id === "mcp" ? await probeMcp() : selected.id === "x402" ? await probeX402() : await probeJson(`${GATEWAY_INTERNAL_URL}/health`);
    return NextResponse.json({ target, selected, boundary: { authority: "MANDATE policy core remains the execution authority", modelControlsAmount: false, modelControlsPaymentSecret: false, execution: selected.demoEnabled ? "available-in-demo" : "not-executable" }, referenceProtocol: reference ?? selected, trace });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "PROTOCOL_ROUTE_UNAVAILABLE" }, { status: 409 }); }
}
