import Link from "next/link";
import { growthCampaigns } from "../../../lib/campaigns";

export const dynamic = "force-dynamic";

const MCP_INTERNAL_URL = (process.env.MCP_INTERNAL_URL ?? "http://localhost:4100").replace(/\/$/, "");
const MCP_AGENT_TOKEN = process.env.MCP_AGENT_TOKEN ?? "";
const GATEWAY_INTERNAL_URL = (process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");

const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);

type MerchantOrder = {
  merchantOrderId: string;
  transactionId: string;
  amountPaise: number;
  incrementalRevenuePaise: number;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
};

type Proof = {
  verified: true;
  testMode: true;
  transactionId: string;
  orderId: string;
  paymentId: string;
  amountPaise: number;
  payment: { status: string; method: string | null };
  order: { status: string; notes?: Record<string, unknown> };
};

async function loadOrders(): Promise<MerchantOrder[]> {
  try {
    const response = await fetch(`${GATEWAY_INTERNAL_URL}/v1/merchant/orders`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!response.ok) return [];
    const body = await response.json() as { orders?: MerchantOrder[] };
    return Array.isArray(body.orders) ? body.orders : [];
  } catch { return []; }
}

async function verify(order: MerchantOrder): Promise<Proof | null> {
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
      body: JSON.stringify({ jsonrpc: "2.0", id: `campaign-evidence-${order.transactionId}`, method: "tools/call", params: { name: "mandate_razorpay_verify_settlement", arguments: { transactionId: order.transactionId, orderId: order.razorpayOrderId, paymentId: order.razorpayPaymentId } } }),
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });
    const body = await response.json().catch(() => null) as { result?: { isError?: boolean; structuredContent?: Proof } } | null;
    const proof = body?.result?.structuredContent;
    return response.ok && body?.result?.isError !== true && proof?.verified === true && proof?.testMode === true ? proof : null;
  } catch { return null; }
}

export default async function CampaignEvidencePage() {
  const verified = (await Promise.all((await loadOrders()).slice(0, 50).map(async (order) => ({ order, proof: await verify(order) })))).filter((entry): entry is { order: MerchantOrder; proof: Proof } => Boolean(entry.proof));
  const rows = verified.map(({ order, proof }) => ({
    ...order,
    campaignId: typeof proof.order.notes?.growth_campaign_id === "string" ? proof.order.notes.growth_campaign_id : null,
    method: proof.payment.method ?? "unknown",
    captured: proof.payment.status === "captured" && (proof.order.status === "paid" || proof.order.status === "created" || proof.order.status === "paid"),
  }));
  const campaignIds = new Set(growthCampaigns.map((campaign) => campaign.id));
  const attributed = rows.filter((row) => row.campaignId && campaignIds.has(row.campaignId));
  const uplift = attributed.reduce((sum, row) => sum + row.incrementalRevenuePaise, 0);

  return <main style={{ minHeight: "100vh", background: "#f6f6f2", color: "#171717", fontFamily: "Arial, sans-serif", padding: "34px 20px 70px" }}><div style={{ maxWidth: 1220, margin: "0 auto" }}>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 20, marginBottom: 26 }}><div><div style={{ fontSize: 11, color: "#1e5b3e", letterSpacing: ".12em", fontWeight: 800 }}>MERCHANT GROWTH · PAYMENT EVIDENCE</div><h1 style={{ fontSize: 46, lineHeight: 1, letterSpacing: "-.045em", margin: "9px 0 11px" }}>Every uplift number has a payment behind it.</h1><p style={{ maxWidth: 820, color: "#666", lineHeight: 1.65, margin: 0 }}>This ledger is built only from merchant orders whose Razorpay order and payment were fetched again through the authenticated MANDATE MCP boundary and confirmed as Test Mode evidence.</p></div><div style={{ display: "flex", gap: 8 }}><Link href="/campaigns/attribution" style={{ padding: "10px 12px", border: "1px solid #ccc", color: "#171717", textDecoration: "none", fontSize: 11, fontWeight: 800 }}>Attribution summary</Link><Link href="/growth" style={{ padding: "10px 12px", background: "#171717", color: "white", textDecoration: "none", fontSize: 11, fontWeight: 800 }}>Growth dashboard</Link></div></header>

    <section style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 15 }}>{[["Verified payments", String(rows.length)], ["Attributed", String(attributed.length)], ["Campaign uplift", money(uplift)], ["Mode", "RAZORPAY TEST"]].map(([label, value]) => <div key={label} style={{ background: "white", border: "1px solid #dddcd7", padding: 18 }}><div style={{ fontSize: 9, color: "#777", letterSpacing: ".1em", fontWeight: 800 }}>{label}</div><strong style={{ display: "block", marginTop: 7, fontSize: 24 }}>{value}</strong></div>)}</section>

    <section style={{ background: "white", border: "1px solid #dddcd7" }}><div style={{ padding: 18, borderBottom: "1px solid #e7e7e3" }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 800 }}>LIVE PAYMENT LEDGER</div><h2 style={{ margin: "7px 0 0", fontSize: 24 }}>Razorpay Test Mode evidence</h2></div>{rows.length === 0 ? <div style={{ padding: 28, color: "#777", fontSize: 13 }}>No independently verified Test Mode payments yet. Complete the real Razorpay Checkout path first.</div> : <div>{rows.map((row) => <div key={row.transactionId} style={{ display: "grid", gridTemplateColumns: "1.1fr .9fr .9fr .65fr .7fr", gap: 14, alignItems: "center", padding: 16, borderBottom: "1px solid #eee" }}><div><strong>{row.campaignId ?? "Unattributed"}</strong><div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 9, color: "#777", wordBreak: "break-all" }}>{row.transactionId}</div></div><div><div style={{ fontSize: 9, color: "#777" }}>RAZORPAY ORDER</div><div style={{ fontFamily: "monospace", fontSize: 10, marginTop: 4 }}>{row.razorpayOrderId}</div></div><div><div style={{ fontSize: 9, color: "#777" }}>PAYMENT</div><div style={{ fontFamily: "monospace", fontSize: 10, marginTop: 4 }}>{row.razorpayPaymentId}</div><div style={{ color: "#666", fontSize: 10, marginTop: 3 }}>{row.method}</div></div><div><div style={{ fontSize: 9, color: "#777" }}>AMOUNT</div><strong>{money(row.amountPaise)}</strong></div><div style={{ textAlign: "right" }}><div style={{ fontSize: 9, color: "#777" }}>UPLIFT</div><strong style={{ color: "#1e5b3e" }}>+{money(row.incrementalRevenuePaise)}</strong><div style={{ marginTop: 5, fontSize: 9, fontWeight: 800, color: "#1e5b3e" }}>TEST VERIFIED</div></div></div>)}</div>}</section>

    <section style={{ marginTop: 15, background: "#171717", color: "white", padding: 20 }}><div style={{ fontSize: 10, letterSpacing: ".1em", color: "#aaa", fontWeight: 800 }}>EVIDENCE CHAIN</div><div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10, fontSize: 12 }}><span>MANDATE transaction</span><b>→</b><span>Razorpay Test Order</span><b>→</b><span>Razorpay Payment</span><b>→</b><span>Captured</span><b>→</b><span>Campaign ID</span><b>→</b><span>Realized uplift</span></div><p style={{ margin: "11px 0 0", color: "#bbb", fontSize: 11, lineHeight: 1.6 }}>A captured payment without a recognized campaign ID remains valid payment evidence but is intentionally excluded from campaign attribution.</p></section>
  </div></main>;
}
