import { NextResponse } from "next/server";

const gateway = (process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");
const merchant = (process.env.MERCHANT_INTERNAL_URL ?? "http://localhost:3000").replace(/\/$/, "");
const mcp = (process.env.MCP_INTERNAL_URL ?? "http://localhost:4100").replace(/\/$/, "");

type DeepStatusBody = {
  testMode?: boolean;
  configured?: boolean;
  probe?: { testMode?: boolean; detail?: string };
  razorpayTestMode?: boolean;
  razorpayApiReachable?: boolean;
  razorpayProbe?: { detail?: string };
};

async function probe(url: string, init: RequestInit = {}) {
  try {
    const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(5000) });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: { error: error instanceof Error ? error.message : "UNAVAILABLE" } };
  }
}

export async function GET() {
  const [gatewayHealth, merchantHealth, mcpHealth, razorpayStatus] = await Promise.all([
    probe(`${gateway}/health`),
    probe(`${merchant}/api/health`),
    probe(`${mcp}/health?deep=1`),
    probe(`${gateway}/v1/internal/razorpay/status?deep=1`, {
      headers: { "x-mandate-gateway-secret": process.env.INTERNAL_GATEWAY_SECRET ?? "" },
    }),
  ]);

  const mcpBody = (mcpHealth.body ?? {}) as DeepStatusBody;
  const razorpayBody = (razorpayStatus.body ?? {}) as DeepStatusBody;
  const checks = [
    { key: "gateway", label: "MANDATE gateway", ok: gatewayHealth.ok, detail: gatewayHealth.ok ? "authorization core reachable" : "gateway unavailable" },
    { key: "merchant", label: "Merchant agent", ok: merchantHealth.ok, detail: merchantHealth.ok ? "catalog and agent runtime reachable" : "merchant unavailable" },
    { key: "razorpay", label: "Razorpay Test Mode", ok: razorpayBody.testMode === true && razorpayBody.configured === true, detail: razorpayBody.testMode === true ? "rzp_test_* configured" : "Test Mode credentials required" },
    { key: "razorpayApi", label: "Razorpay API probe", ok: razorpayBody.probe?.testMode === true, detail: razorpayBody.probe?.detail && typeof razorpayBody.probe.detail === "string" ? razorpayBody.probe.detail : "Deep Razorpay probe not confirmed" },
    { key: "mcp", label: "MCP payment policy", ok: mcpHealth.ok && mcpBody.razorpayTestMode === true && mcpBody.razorpayApiReachable === true, detail: mcpBody.razorpayProbe?.detail && typeof mcpBody.razorpayProbe.detail === "string" ? mcpBody.razorpayProbe.detail : "MCP Test Mode probe not confirmed" },
  ];

  const ready = checks.every((check) => check.ok);
  return NextResponse.json({
    ready,
    mode: ready ? "razorpay-test-mode" : "blocked-until-test-mode-ready",
    checks,
    sequence: [
      { step: 1, name: "Buyer intent", route: "/negotiation", sideEffect: "none" },
      { step: 2, name: "Merchant negotiation", route: "/negotiation", sideEffect: "none" },
      { step: 3, name: "MANDATE authorization", route: "/negotiation", sideEffect: "authorization only" },
      { step: 4, name: "Razorpay Test Checkout", route: "/negotiation", sideEffect: "real Test Mode payment" },
      { step: 5, name: "Webhook reconciliation", route: "/proof", sideEffect: "server-side evidence" },
      { step: 6, name: "Merchant growth attribution", route: "/campaigns/attribution", sideEffect: "realized uplift only" },
    ],
  }, { headers: { "cache-control": "no-store" } });
}
