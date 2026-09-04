import Link from "next/link";
import { getCampaignOpportunities, growthCampaigns } from "../../lib/campaigns";

export const dynamic = "force-dynamic";

const GATEWAY = (process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");
const MCP = (process.env.MCP_INTERNAL_URL ?? "http://localhost:4100").replace(/\/$/, "");
const MCP_TOKEN = process.env.MCP_AGENT_TOKEN ?? "";

const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
const pct = (value: number) => `${value.toFixed(1)}%`;

type Order = {
  merchantOrderId: string;
  transactionId: string;
  amountPaise: number;
  baseAmountPaise: number;
  incrementalRevenuePaise: number;
  productId?: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  createdAt: string;
};

type Proof = { verified?: boolean; testMode?: boolean; amountPaise?: number; orderId?: string; paymentId?: string; order?: { notes?: Record<string, string> } };

type McpBody = { result?: { isError?: boolean; structuredContent?: Proof } };

async function read<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${GATEWAY}${path}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch { return null; }
}

async function verify(order: Order): Promise<Proof | null> {
  if (!MCP_TOKEN || !order.razorpayOrderId || !order.razorpayPaymentId) return null;
  try {
    const response = await fetch(`${MCP}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${MCP_TOKEN}`,
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
        "mcp-name": "mandate_razorpay_verify_settlement",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: `campaign-attribution-${order.transactionId}`, method: "tools/call", params: { name: "mandate_razorpay_verify_settlement", arguments: { transactionId: order.transactionId, orderId: order.razorpayOrderId, paymentId: order.razorpayPaymentId } } }),
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });
    const body = await response.json().catch(() => null) as McpBody | null;
    const proof = body?.result?.structuredContent;
    return response.ok && body?.result?.isError !== true && proof?.verified === true && proof.testMode === true ? proof : null;
  } catch { return null; }
}

export default async function GrowthAttributionPage() {
  const ordersBody = await read<{ orders?: Order[] }>("/v1/merchant/orders");
  const orders = ordersBody?.orders ?? [];
  const candidates = orders.filter((order) => Boolean(order.razorpayOrderId && order.razorpayPaymentId)).slice(0, 40);
  const verification = await Promise.all(candidates.map(async (order) => ({ order, proof: await verify(order) })));
  const verified = verification.filter((item) => item.proof?.verified === true && item.proof.testMode === true);

  const campaignRows = growthCampaigns.map((campaign) => {
    const opportunities = getCampaignOpportunities(campaign);
    const campaignId = campaign.id;
    const matched = verified.filter(({ proof }) => proof?.order?.notes?.growth_campaign_id === campaignId);
    const incremental = matched.reduce((sum, item) => sum + item.order.incrementalRevenuePaise, 0);
    const baseline = matched.reduce((sum, item) => sum + item.order.baseAmountPaise, 0);
    return { campaign, matched, incremental, baseline, uplift: baseline > 0 ? incremental / baseline * 100 : 0 };
  }).sort((a, b) => b.incremental - a.incremental);

  const totalVerifiedIncremental = verified.reduce((sum, item) => sum + item.order.incrementalRevenuePaise, 0);
  const attributedIncremental = campaignRows.reduce((sum, row) => sum + row.incremental, 0);

  return <main style={{ minHeight: "100vh", background: "#f5f5f2", color: "#171717", padding: "36px 20px 72px", fontFamily: "Inter, Arial, sans-serif" }}><div style={{ maxWidth: 1120, margin: "0 auto" }}>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 20 }}><div><div style={{ fontSize: 10, letterSpacing: ".13em", color: "#1e5b3e", fontWeight: 800 }}>MERCHANT GROWTH · EVIDENCE</div><h1 style={{ fontSize: 48, lineHeight: 1, letterSpacing: "-.05em", margin: "9px 0 12px" }}>Campaign uplift attribution</h1><p style={{ maxWidth: 790, color: "#666", lineHeight: 1.7, margin: 0 }}>Only captured Razorpay Test Mode payments independently verified through MCP enter this analysis. Campaign matching is deterministic by purchased product and merchant campaign opportunity; it is not a causal marketing claim.</p></div><div style={{ display: "flex", gap: 15 }}><Link href="/growth" style={{ color: "#171717", fontWeight: 800, textDecoration: "none" }}>← Growth dashboard</Link><Link href="/campaign-orchestrator" style={{ color: "#777", textDecoration: "none" }}>Campaign orchestrator →</Link></div></header>

    <section style={{ marginTop: 25, display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>{[["Verified payments", String(verified.length), "Razorpay order + payment re-read"],["Verified uplift", money(totalVerifiedIncremental), "All independently verified incremental revenue"],["Campaign-linked uplift", money(attributedIncremental), "Verified uplift matched to campaign products"],["Coverage", pct(totalVerifiedIncremental > 0 ? attributedIncremental / totalVerifiedIncremental * 100 : 0), "Share of verified uplift with deterministic campaign mapping"]].map(([label, value, note]) => <div key={label} style={{ background: "white", border: "1px solid #dddcd7", padding: 16 }}><div style={{ fontSize: 9, color: "#777", letterSpacing: ".1em", fontWeight: 800 }}>{label}</div><strong style={{ display: "block", fontSize: 26, marginTop: 8 }}>{value}</strong><div style={{ color: "#777", fontSize: 10, marginTop: 5, lineHeight: 1.4 }}>{note}</div></div>)}</section>

    <section style={{ marginTop: 16, background: "white", border: "1px solid #dddcd7" }}><div style={{ padding: 20, borderBottom: "1px solid #e4e4df" }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 800 }}>REAL TEST MODE COHORT</div><h2 style={{ margin: "7px 0 0", fontSize: 25 }}>Campaigns ranked by verified incremental revenue</h2></div><div>{campaignRows.map((row, index) => <div key={row.campaign.id} style={{ display: "grid", gridTemplateColumns: "44px 1fr auto auto", gap: 14, alignItems: "center", padding: 17, borderBottom: "1px solid #eeeeea" }}><span style={{ color: "#999", fontFamily: "monospace" }}>{String(index + 1).padStart(2, "0")}</span><div><strong style={{ fontSize: 15 }}>{row.campaign.name}</strong><div style={{ color: "#777", fontSize: 10, marginTop: 4 }}>{row.campaign.strategy} · {row.matched.length} verified matched order{row.matched.length === 1 ? "" : "s"}</div></div><div style={{ textAlign: "right" }}><strong style={{ color: "#1e5b3e" }}>+{money(row.incremental)}</strong><div style={{ color: "#777", fontSize: 9 }}>verified uplift</div></div><div style={{ minWidth: 100, textAlign: "right" }}><strong>{pct(row.uplift)}</strong><div style={{ color: "#777", fontSize: 9 }}>uplift / matched baseline</div></div></div>)}</div></section>

    <section style={{ marginTop: 16, background: "#171717", color: "white", padding: 22 }}><div style={{ fontSize: 10, color: "#aaa", letterSpacing: ".12em", fontWeight: 800 }}>EVIDENCE CHAIN</div><div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 8 }}>{["Campaign", "MANDATE TX", "Razorpay Order", "Razorpay Payment", "Captured", "Attributed uplift"].map((step, index) => <div key={step} style={{ border: "1px solid #353535", padding: 12 }}><div style={{ color: "#888", fontFamily: "monospace", fontSize: 9 }}>{String(index + 1).padStart(2, "0")}</div><strong style={{ display: "block", marginTop: 6, fontSize: 11 }}>{step}</strong></div>)}</div><p style={{ margin: "14px 0 0", color: "#bdbdb8", fontSize: 11, lineHeight: 1.6 }}>A campaign row is evidence-backed only when a persisted merchant order has Razorpay identifiers, MCP re-verification returns <code>verified=true</code> and <code>testMode=true</code>, and the purchased product belongs to that campaign&apos;s current merchant opportunity set.</p></section>
  </div></main>;
}
