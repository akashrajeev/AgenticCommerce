import { NextResponse } from "next/server";

const GATEWAY_INTERNAL_URL = process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000";
const MERCHANT_INTERNAL_URL = process.env.MERCHANT_INTERNAL_URL ?? "http://localhost:3000";
const MCP_INTERNAL_URL = process.env.MCP_INTERNAL_URL ?? "http://localhost:4100";

type Check = { key: string; label: string; ok: boolean; detail: string };

async function request(url: string, init?: RequestInit) {
  return fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(6000) });
}

export async function GET() {
  const checks: Check[] = [];
  try {
    const [gatewayHealth, gatewayRoot, merchantHealth, manifest, transactions, orders, mcpHealth] = await Promise.all([
      request(`${GATEWAY_INTERNAL_URL}/health`),
      request(`${GATEWAY_INTERNAL_URL}/`),
      request(`${MERCHANT_INTERNAL_URL}/api/health`),
      request(`${MERCHANT_INTERNAL_URL}/.well-known/agent-commerce`),
      request(`${GATEWAY_INTERNAL_URL}/v1/transactions`),
      request(`${GATEWAY_INTERNAL_URL}/v1/merchant/orders`),
      request(`${MCP_INTERNAL_URL}/health?deep=1`),
    ]);

    checks.push({ key: "gateway", label: "Gateway", ok: gatewayHealth.ok, detail: gatewayHealth.ok ? "healthy" : `HTTP ${gatewayHealth.status}` });
    const gatewayInfo = gatewayRoot.ok ? await gatewayRoot.json().catch(() => null) as { status?: string; testMode?: boolean } | null : null;
    checks.push({ key: "razorpay", label: "Razorpay rail", ok: gatewayRoot.ok && gatewayInfo?.status === "razorpay-test-ready" && gatewayInfo?.testMode === true, detail: gatewayInfo?.testMode === true ? "Razorpay Test Mode rail configured" : gatewayInfo?.status ?? `HTTP ${gatewayRoot.status}` });
    checks.push({ key: "merchant", label: "Merchant", ok: merchantHealth.ok, detail: merchantHealth.ok ? "healthy" : `HTTP ${merchantHealth.status}` });
    const manifestBody = manifest.ok ? await manifest.json().catch(() => null) as { merchantId?: string; version?: string } | null : null;
    checks.push({ key: "manifest", label: "Agent manifest", ok: manifest.ok && Boolean(manifestBody?.merchantId), detail: manifestBody?.merchantId ? `${manifestBody.merchantId} · v${manifestBody.version ?? "?"}` : `HTTP ${manifest.status}` });
    const txBody = transactions.ok ? await transactions.json().catch(() => null) as { transactions?: unknown[] } | null : null;
    const orderBody = orders.ok ? await orders.json().catch(() => null) as { orders?: unknown[]; revenue?: { realizedIncrementalRevenuePaise?: number } } | null : null;
    const mcpBody = mcpHealth.ok ? await mcpHealth.json().catch(() => null) as { app?: string; transport?: string; protocolVersions?: string[]; razorpayTestMode?: boolean; razorpayApiReachable?: boolean; razorpayProbe?: { detail?: string; latencyMs?: number } } | null : null;
    const apiLive = mcpBody?.razorpayApiReachable === true;
    checks.push({ key: "razorpay-test-mode", label: "Razorpay Test Mode", ok: mcpHealth.ok && mcpBody?.razorpayTestMode === true && apiLive, detail: apiLive ? `rzp_test_* gate active · API reachable${typeof mcpBody?.razorpayProbe?.latencyMs === "number" ? ` · ${mcpBody.razorpayProbe.latencyMs}ms` : ""}` : mcpBody?.razorpayProbe?.detail ?? "Test Mode API is not reachable" });
    checks.push({ key: "transaction-store", label: "Transaction store", ok: transactions.ok, detail: `${txBody?.transactions?.length ?? 0} visible transaction(s)` });
    checks.push({ key: "revenue-store", label: "Revenue attribution", ok: orders.ok, detail: `${orderBody?.orders?.length ?? 0} persisted merchant order(s)` });
    checks.push({ key: "mcp", label: "MANDATE MCP facade", ok: mcpHealth.ok && mcpBody?.app === "mandate-mcp", detail: mcpBody?.transport ? `${mcpBody.transport} · ${mcpBody.protocolVersions?.join(", ") ?? "no versions"}` : `HTTP ${mcpHealth.status}` });

    return NextResponse.json({ ready: checks.every((check) => check.ok), checks, generatedAt: new Date().toISOString(), stats: { transactions: txBody?.transactions?.length ?? 0, merchantOrders: orderBody?.orders?.length ?? 0, realizedIncrementalRevenuePaise: orderBody?.revenue?.realizedIncrementalRevenuePaise ?? 0 } });
  } catch (error) {
    return NextResponse.json({ ready: false, checks, error: error instanceof Error ? error.message : "DEMO_STATUS_UNAVAILABLE" }, { status: 502 });
  }
}
