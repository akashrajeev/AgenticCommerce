import { NextResponse } from "next/server";

const GATEWAY_INTERNAL_URL = process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000";
const MERCHANT_INTERNAL_URL = process.env.MERCHANT_INTERNAL_URL ?? "http://localhost:3000";
const GATEWAY_SECRET = process.env.INTERNAL_GATEWAY_SECRET ?? process.env.GATEWAY_INTERNAL_SECRET ?? "";

type Check = { key: string; label: string; ok: boolean; detail: string };

async function request(url: string, init?: RequestInit) {
  return fetch(url, { ...init, cache: "no-store" });
}

export async function GET() {
  const checks: Check[] = [];
  try {
    const [gatewayHealth, gatewayRoot, merchantHealth, manifest, transactions, orders] = await Promise.all([
      request(`${GATEWAY_INTERNAL_URL}/health`),
      request(`${GATEWAY_INTERNAL_URL}/`),
      request(`${MERCHANT_INTERNAL_URL}/health`),
      request(`${MERCHANT_INTERNAL_URL}/.well-known/agent-commerce`),
      request(`${GATEWAY_INTERNAL_URL}/v1/transactions`),
      request(`${GATEWAY_INTERNAL_URL}/v1/merchant/orders`),
    ]);

    checks.push({ key: "gateway", label: "Gateway", ok: gatewayHealth.ok, detail: gatewayHealth.ok ? "healthy" : `HTTP ${gatewayHealth.status}` });
    const gatewayInfo = gatewayRoot.ok ? await gatewayRoot.json().catch(() => null) as { status?: string } | null : null;
    checks.push({ key: "razorpay", label: "Razorpay rail", ok: gatewayRoot.ok && gatewayInfo?.status === "razorpay-test-ready", detail: gatewayInfo?.status ?? `HTTP ${gatewayRoot.status}` });
    checks.push({ key: "merchant", label: "Merchant", ok: merchantHealth.ok, detail: merchantHealth.ok ? "healthy" : `HTTP ${merchantHealth.status}` });
    const manifestBody = manifest.ok ? await manifest.json().catch(() => null) as { merchantId?: string; version?: string } | null : null;
    checks.push({ key: "manifest", label: "Agent manifest", ok: manifest.ok && Boolean(manifestBody?.merchantId), detail: manifestBody?.merchantId ? `${manifestBody.merchantId} · v${manifestBody.version ?? "?"}` : `HTTP ${manifest.status}` });
    const txBody = transactions.ok ? await transactions.json().catch(() => null) as { transactions?: unknown[] } | null : null;
    const orderBody = orders.ok ? await orders.json().catch(() => null) as { orders?: unknown[]; revenue?: { realizedIncrementalRevenuePaise?: number } } | null : null;
    checks.push({ key: "transaction-store", label: "Transaction store", ok: transactions.ok, detail: `${txBody?.transactions?.length ?? 0} visible transaction(s)` });
    checks.push({ key: "revenue-store", label: "Revenue attribution", ok: orders.ok, detail: `${orderBody?.orders?.length ?? 0} persisted merchant order(s)` });

    return NextResponse.json({ ready: checks.every((check) => check.ok), checks, generatedAt: new Date().toISOString(), stats: { transactions: txBody?.transactions?.length ?? 0, merchantOrders: orderBody?.orders?.length ?? 0, realizedIncrementalRevenuePaise: orderBody?.revenue?.realizedIncrementalRevenuePaise ?? 0 } });
  } catch (error) {
    return NextResponse.json({ ready: false, checks, error: error instanceof Error ? error.message : "DEMO_STATUS_UNAVAILABLE" }, { status: 502 });
  }
}
