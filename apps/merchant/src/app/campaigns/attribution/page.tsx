import Link from "next/link";
import { getCampaignOpportunities, growthCampaigns } from "../../../lib/campaigns";

export const dynamic = "force-dynamic";

const MCP_INTERNAL_URL = (process.env.MCP_INTERNAL_URL ?? "http://localhost:4100").replace(/\/$/, "");
const MCP_AGENT_TOKEN = process.env.MCP_AGENT_TOKEN ?? "";

const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
const pct = (value: number) => `${value.toFixed(1)}%`;

type Order = {
  merchantOrderId: string;
  transactionId: string;
  amountPaise: number;
  baseAmountPaise: number;
  incrementalRevenuePaise: number;
  createdAt: string;
  productId?: string;
  lineItems?: Array<{ productId: string; quantity: number }>;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
};

type Proof = { verified: true; testMode: true; amountPaise: number; orderId: string; paymentId: string };

type McpResponse = { result?: { isError?: boolean; structuredContent?: Proof } };

async function loadOrders(): Promise<Order[]> {
  const gateway = process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000";
  try {
    const response = await fetch(`${gateway}/v1/merchant/orders`, { cache: "no-store" });
    if (!response.ok) return [];
    const body = await response.json() as { orders?: Order[] };
    return Array.isArray(body.orders) ? body.orders : [];
  } catch {
    return [];
  }
}

async function verify(order: Order): Promise<Proof | null> {
  if (!MCP_AGENT_TOKEN || !order.razorpayOrderId || !order.razorpayPaymentId) return null;
  try {
    const response = await fetch(`${MCP_INTERNAL_URL}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${MCP_AGENT_TOKEN}`,
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
        "mcp-name": "mandate_razorpay_verify_settlement",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `campaign-attribution-${order.transactionId}`,
        method: "tools/call",
        params: { name: "mandate_razorpay_verify_settlement", arguments: { transactionId: order.transactionId, orderId: order.razorpayOrderId, paymentId: order.razorpayPaymentId } },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.json().catch(() => null) as McpResponse | null;
    const proof = body?.result?.structuredContent;
    return response.ok && body?.result?.isError !== true && proof?.verified === true && proof.testMode === true ? proof : null;
  } catch {
    return null;
  }
}

function orderProductIds(order: Order): Set<string> {
  const ids = new Set<string>();
  if (order.productId) ids.add(order.productId);
  for (const line of order.lineItems ?? []) ids.add(line.productId);
  return ids;
}

export default async function CampaignAttributionPage() {
  const orders = await loadOrders();
  const verified = (await Promise.all(orders.slice(0, 25).map(async (order) => ({ order, proof: await verify(order) })))).filter((item): item is { order: Order; proof: Proof } => Boolean(item.proof));

  const campaignRows = growthCampaigns.map((campaign) => {
    const targetIds = new Set(getCampaignOpportunities(campaign).map((item) => item.productId));
    const attributed = verified.filter(({ order }) => {
      const ids = orderProductIds(order);
      return ids.size === 1 && [...ids][0] && targetIds.has([...ids][0]!);
    });
    const incremental = attributed.reduce((sum, item) => sum + item.order.incrementalRevenuePaise, 0);
    const base = attributed.reduce((sum, item) => sum + item.order.baseAmountPaise, 0);
    return { campaign, attributed, incremental, base, upliftPct: base > 0 ? (incremental / base) * 100 : 0 };
  });

  const ambiguous = verified.filter(({ order }) => {
    const ids = orderProductIds(order);
    const matches = growthCampaigns.filter((campaign) => {
      const targets = new Set(getCampaignOpportunities(campaign).map((item) => item.productId));
      return [...ids].some((id) => targets.has(id));
    });
    return matches.length !== 1;
  });

  return <main style={{ minHeight: "100vh", background: "#f7f7f3", color: "#171717", fontFamily: "Inter, Arial, sans-serif", padding: "36px 20px 72px" }}><div style={{ maxWidth: 1180, margin: "0 auto" }}>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 20, marginBottom: 28 }}><div><div style={{ fontSize: 11, color: "#1e5b3e", letterSpacing: ".12em", fontWeight: 800 }}>MERCHANT GROWTH / ATTRIBUTION</div><h1 style={{ fontSize: 48, lineHeight: 1.02, letterSpacing: "-.04em", margin: "8px 0 10px" }}>Which campaign actually created the uplift?</h1><p style={{ maxWidth: 820, color: "#666", lineHeight: 1.6 }}>Only Razorpay Test Mode captured payments independently re-read through the MCP verification boundary are eligible. Orders are attributed only when the campaign match is unambiguous.</p></div><div style={{ display: "flex", gap: 8 }}><Link href="/campaigns" style={{ border: "1px solid #ccc", padding: "10px 12px", color: "#171717", textDecoration: "none", fontSize: 11, fontWeight: 800 }}>Campaign orchestrator</Link><Link href="/growth" style={{ background: "#171717", color: "white", padding: "10px 12px", textDecoration: "none", fontSize: 11, fontWeight: 800 }}>Growth dashboard</Link></div></header>

    <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
      {[["Verified payments", String(verified.length), "Razorpay Test Mode captured + independently re-read"], ["Campaign-attributed", String(verified.length - ambiguous.length), "Orders with exactly one campaign match"], ["Unassigned / ambiguous", String(ambiguous.length), "Excluded from campaign uplift to avoid double counting"], ["Verified uplift", money(verified.reduce((sum, item) => sum + item.order.incrementalRevenuePaise, 0)), "Captured incremental revenue across verified orders"]].map(([label, value, note]) => <div key={label} style={{ background: "white", border: "1px solid #dddcd7", padding: 18 }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".08em", fontWeight: 800 }}>{label}</div><div style={{ fontSize: 27, fontWeight: 800, marginTop: 8 }}>{value}</div><div style={{ color: "#777", fontSize: 10, lineHeight: 1.4, marginTop: 5 }}>{note}</div></div>)}
    </section>

    <section style={{ background: "white", border: "1px solid #dddcd7" }}><div style={{ padding: 18, borderBottom: "1px solid #e7e7e3" }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 800 }}>REALIZED CAMPAIGN RESULTS</div><h2 style={{ margin: "7px 0 0", fontSize: 25 }}>Razorpay-verified uplift by campaign</h2></div><div>{campaignRows.map(({ campaign, attributed, incremental, upliftPct }) => <div key={campaign.id} style={{ display: "grid", gridTemplateColumns: "1.1fr .7fr .6fr .6fr", gap: 14, alignItems: "center", padding: 18, borderBottom: "1px solid #eee" }}><div><strong>{campaign.name}</strong><div style={{ color: "#777", fontSize: 10, marginTop: 4 }}>{campaign.objective}</div><div style={{ color: "#777", fontSize: 10, marginTop: 4 }}>{campaign.strategy} · {getCampaignOpportunities(campaign).length} live opportunity pairings</div></div><div><div style={{ fontSize: 10, color: "#777" }}>VERIFIED ORDERS</div><strong>{attributed.length}</strong></div><div><div style={{ fontSize: 10, color: "#777" }}>REALIZED LIFT</div><strong style={{ color: "#1e5b3e" }}>+{money(incremental)}</strong></div><div><div style={{ fontSize: 10, color: "#777" }}>UPLIFT RATE</div><strong>{pct(upliftPct)}</strong></div></div>)}</div></section>

    <section style={{ marginTop: 16, background: "#171717", color: "white", padding: 20 }}><div style={{ fontSize: 10, letterSpacing: ".1em", color: "#aaa", fontWeight: 800 }}>NO-MOCK EVIDENCE CONTRACT</div><p style={{ maxWidth: 900, color: "#ccc", fontSize: 12, lineHeight: 1.7, margin: "8px 0 0" }}>A campaign receives realized uplift only from a persisted merchant order whose Razorpay order and payment are fetched again, amount- and transaction-bound, and confirmed captured in Test Mode. Orders that could belong to multiple campaigns are intentionally excluded rather than double-counted.</p></section>

    {ambiguous.length > 0 ? <section style={{ marginTop: 16, background: "#fffaf7", border: "1px solid #ead6ce", padding: 18 }}><strong style={{ color: "#7b302b" }}>Excluded from attribution: {ambiguous.length}</strong><div style={{ color: "#7b302b", fontSize: 11, marginTop: 5 }}>These verified payments match more than one campaign or do not have a unique campaign mapping. They remain valid revenue evidence but are not assigned to a campaign.</div></section> : null}
  </div></main>;
}
