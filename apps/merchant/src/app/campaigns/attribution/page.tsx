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

type Proof = { verified: true; testMode: true; amountPaise: number; orderId: string; paymentId: string; order?: { notes?: Record<string, string>; status?: string }; payment?: { status?: string; method?: string | null } };

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

export default async function CampaignAttributionPage() {
  const orders = await loadOrders();
  const verified = (await Promise.all(orders.slice(0, 25).map(async (order) => ({ order, proof: await verify(order) })))).filter((item): item is { order: Order; proof: Proof } => Boolean(item.proof));

  const campaignRows = growthCampaigns.map((campaign) => {
    const attributed = verified.filter(({ proof }) => proof.order?.notes?.growth_campaign_id === campaign.id);
    const incremental = attributed.reduce((sum, item) => sum + item.order.incrementalRevenuePaise, 0);
    const base = attributed.reduce((sum, item) => sum + item.order.baseAmountPaise, 0);
    return { campaign, attributed, incremental, base, upliftPct: base > 0 ? (incremental / base) * 100 : 0 };
  });

  const unattributed = verified.filter(({ proof }) => {
    const campaignId = proof.order?.notes?.growth_campaign_id;
    return !campaignId || !growthCampaigns.some((campaign) => campaign.id === campaignId);
  });

  return <main style={{ minHeight: "100vh", background: "#f7f7f3", color: "#171717", fontFamily: "Inter, Arial, sans-serif", padding: "36px 20px 72px" }}><div style={{ maxWidth: 1180, margin: "0 auto" }}>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 20, marginBottom: 28 }}><div><div style={{ fontSize: 11, color: "#1e5b3e", letterSpacing: ".12em", fontWeight: 800 }}>MERCHANT GROWTH / ATTRIBUTION</div><h1 style={{ fontSize: 48, lineHeight: 1.02, letterSpacing: "-.04em", margin: "8px 0 10px" }}>Which campaign actually created the uplift?</h1><p style={{ maxWidth: 820, color: "#666", lineHeight: 1.6 }}>Only Razorpay Test Mode captured payments independently re-read through the MCP verification boundary are eligible. Campaign ownership comes from the exact growth campaign ID stored on the Razorpay order, not from product-name inference.</p></div><div style={{ display: "flex", gap: 8 }}><Link href="/campaigns" style={{ border: "1px solid #ccc", padding: "10px 12px", color: "#171717", textDecoration: "none", fontSize: 11, fontWeight: 800 }}>Campaign orchestrator</Link><Link href="/growth" style={{ background: "#171717", color: "white", padding: "10px 12px", textDecoration: "none", fontSize: 11, fontWeight: 800 }}>Growth dashboard</Link></div></header>

    <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
      {[["Verified payments", String(verified.length), "Razorpay Test Mode captured + independently re-read"], ["Campaign-attributed", String(verified.length - unattributed.length), "Orders with an exact Razorpay growth campaign ID"], ["Unassigned", String(unattributed.length), "Valid payment evidence excluded from campaign uplift"], ["Verified uplift", money(verified.reduce((sum, item) => sum + item.order.incrementalRevenuePaise, 0)), "Captured incremental revenue across verified orders"]].map(([label, value, note]) => <div key={label} style={{ background: "white", border: "1px solid #dddcd7", padding: 18 }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".08em", fontWeight: 800 }}>{label}</div><div style={{ fontSize: 27, fontWeight: 800, marginTop: 8 }}>{value}</div><div style={{ color: "#777", fontSize: 10, lineHeight: 1.4, marginTop: 5 }}>{note}</div></div>)}
    </section>

    <section style={{ background: "white", border: "1px solid #dddcd7" }}><div style={{ padding: 18, borderBottom: "1px solid #e7e7e3" }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 800 }}>REALIZED CAMPAIGN RESULTS</div><h2 style={{ margin: "7px 0 0", fontSize: 25 }}>Razorpay-verified uplift by campaign</h2></div><div>{campaignRows.map(({ campaign, attributed, incremental, upliftPct }) => <div key={campaign.id} style={{ display: "grid", gridTemplateColumns: "1.1fr .7fr .6fr .6fr", gap: 14, alignItems: "center", padding: 18, borderBottom: "1px solid #eee" }}><div><strong>{campaign.name}</strong><div style={{ color: "#777", fontSize: 10, marginTop: 4 }}>{campaign.objective}</div><div style={{ color: "#777", fontSize: 10, marginTop: 4 }}>{campaign.strategy} · {getCampaignOpportunities(campaign).length} live opportunity pairings</div></div><div><div style={{ fontSize: 10, color: "#777" }}>VERIFIED ORDERS</div><strong>{attributed.length}</strong></div><div><div style={{ fontSize: 10, color: "#777" }}>REALIZED LIFT</div><strong style={{ color: "#1e5b3e" }}>+{money(incremental)}</strong></div><div><div style={{ fontSize: 10, color: "#777" }}>UPLIFT RATE</div><strong>{pct(upliftPct)}</strong></div></div>)}</div></section>

    <section style={{ marginTop: 16, background: "#171717", color: "white", padding: 20 }}><div style={{ fontSize: 10, letterSpacing: ".1em", color: "#aaa", fontWeight: 800 }}>NO-MOCK EVIDENCE CONTRACT</div><p style={{ maxWidth: 900, color: "#ccc", fontSize: 12, lineHeight: 1.7, margin: "8px 0 0" }}>A campaign receives realized uplift only from a persisted merchant order whose Razorpay order and payment are fetched again, amount- and transaction-bound, captured in Test Mode, and whose Razorpay order notes contain the exact campaign ID. Orders without a recognized campaign ID remain valid payment evidence but are excluded from campaign attribution.</p></section>

    {unattributed.length > 0 ? <section style={{ marginTop: 16, background: "#fffaf7", border: "1px solid #ead6ce", padding: 18 }}><strong style={{ color: "#7b302b" }}>Not attributed: {unattributed.length}</strong><div style={{ color: "#7b302b", fontSize: 11, marginTop: 5 }}>These captured Test Mode payments are real evidence but do not carry a recognized growth campaign ID, so they are intentionally excluded from campaign uplift.</div></section> : null}
  </div></main>;
}
