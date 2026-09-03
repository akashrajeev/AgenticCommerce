import Link from "next/link";
import { catalog, findProduct } from "../../lib/catalog";
import { getCampaignOpportunities, growthCampaigns } from "../../lib/campaigns";

export const dynamic = "force-dynamic";
const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
const moneyExact = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(paise / 100);
const pct = (value: number) => `${value.toFixed(1)}%`;

const MCP_INTERNAL_URL = (process.env.MCP_INTERNAL_URL ?? "http://localhost:4100").replace(/\/$/, "");
const MCP_AGENT_TOKEN = process.env.MCP_AGENT_TOKEN ?? "";

type PersistedOrder = { merchantOrderId: string; transactionId: string; amountPaise: number; baseAmountPaise: number; incrementalRevenuePaise: number; createdAt: string; productId?: string; quantity?: number; razorpayOrderId?: string; razorpayPaymentId?: string; lineItems?: Array<{ productId: string; quantity: number }> };
type RevenueSnapshot = { confirmedOrders?: number; realizedIncrementalRevenuePaise?: number; upliftedOrders?: number };
type RazorpayProof = { verified: true; testMode: true; transactionId: string; orderId: string; paymentId: string; amountPaise: number; currency: string; order: { id: string; status: string; amount: number; amountPaid: number; receipt: string }; payment: { id: string; status: string; amount: number; currency: string; orderId: string | null; method: string | null } };

type McpToolResponse = { result?: { isError?: boolean; structuredContent?: RazorpayProof; content?: Array<{ text?: string }> }; error?: { message?: string } };

async function loadOrders(): Promise<{ orders: PersistedOrder[]; revenue: RevenueSnapshot }> {
  const gateway = process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000";
  try {
    const response = await fetch(`${gateway}/v1/merchant/orders`, { cache: "no-store" });
    if (!response.ok) return { orders: [], revenue: {} };
    const body = await response.json() as { orders?: PersistedOrder[]; revenue?: RevenueSnapshot };
    return { orders: body.orders ?? [], revenue: body.revenue ?? {} };
  } catch {
    return { orders: [], revenue: {} };
  }
}

async function verifyRazorpaySettlement(order: PersistedOrder): Promise<RazorpayProof | null> {
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
      body: JSON.stringify({ jsonrpc: "2.0", id: `growth-${order.transactionId}`, method: "tools/call", params: { name: "mandate_razorpay_verify_settlement", arguments: { transactionId: order.transactionId, orderId: order.razorpayOrderId, paymentId: order.razorpayPaymentId } } }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.json().catch(() => null) as McpToolResponse | null;
    const proof = body?.result?.structuredContent;
    return response.ok && body?.result?.isError !== true && proof?.verified === true && proof.testMode === true ? proof : null;
  } catch {
    return null;
  }
}

export default async function GrowthCommandCenter() {
  const { orders, revenue } = await loadOrders();
  const primary = growthCampaigns[0];
  const primaryOpportunities = primary ? getCampaignOpportunities(primary) : [];
  const eligiblePairings = growthCampaigns.reduce((sum, campaign) => sum + getCampaignOpportunities(campaign).length, 0);
  const realized = revenue.realizedIncrementalRevenuePaise ?? 0;
  const upliftedOrders = revenue.upliftedOrders ?? orders.filter((order) => order.incrementalRevenuePaise > 0).length;

  const candidates = orders.filter((order) => Boolean(order.razorpayOrderId && order.razorpayPaymentId)).slice(0, 10);
  const verificationResults = await Promise.all(candidates.map(async (order) => [order.transactionId, await verifyRazorpaySettlement(order)] as const));
  const verifiedByTransaction = new Map(verificationResults.filter(([, proof]) => proof).map(([transactionId, proof]) => [transactionId, proof!]));
  const verifiedOrders = candidates.filter((order) => verifiedByTransaction.has(order.transactionId));
  const batchOrders = verifiedOrders.slice(0, 25);
  const batchBasePaise = batchOrders.reduce((sum, order) => sum + order.baseAmountPaise, 0);
  const batchRevenuePaise = batchOrders.reduce((sum, order) => sum + order.amountPaise, 0);
  const batchIncrementalPaise = batchOrders.reduce((sum, order) => sum + order.incrementalRevenuePaise, 0);
  const batchUpliftPct = batchBasePaise > 0 ? (batchIncrementalPaise / batchBasePaise) * 100 : 0;
  const batchUpliftedOrders = batchOrders.filter((order) => order.incrementalRevenuePaise > 0).length;
  const batchAverageIncremental = batchOrders.length > 0 ? batchIncrementalPaise / batchOrders.length : 0;
  const highestLiftOrders = [...batchOrders].sort((a, b) => b.incrementalRevenuePaise - a.incrementalRevenuePaise).slice(0, 5);
  const maxBar = Math.max(batchBasePaise, batchRevenuePaise, 1);
  const verificationReady = Boolean(MCP_AGENT_TOKEN);

  return <main style={{ minHeight: "100vh", background: "#f7f7f3", color: "#171717", fontFamily: "Arial, sans-serif", padding: "36px 20px 72px" }}><div style={{ maxWidth: 1120, margin: "0 auto" }}>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 30 }}><Link href="/operations" style={{ color: "#666", textDecoration: "none", fontSize: 13 }}>← Operations</Link><span style={{ border: "1px solid #c8d8ce", background: "#eff6f1", color: "#1e5b3e", padding: "7px 10px", fontSize: 11, fontWeight: 700 }}>MERCHANT GROWTH</span></header>
    <section style={{ borderTop: "2px solid #171717", paddingTop: 18 }}><div style={{ fontSize: 11, color: "#777", letterSpacing: ".12em", fontWeight: 700 }}>MANDATE / GROWTH COMMAND CENTER</div><h1 style={{ fontSize: 54, lineHeight: 1, letterSpacing: "-.055em", margin: "10px 0 13px", maxWidth: 860 }}>Turn a product view into a measurable basket-growth loop.</h1><p style={{ maxWidth: 820, color: "#666", lineHeight: 1.7, margin: 0 }}>Merchant-owned campaigns define which product relationships are worth surfacing. The buyer still requires explicit approval and the gateway still controls spend.</p></section>

    <section style={{ marginTop: 28, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
      {[["Eligible pairings", String(eligiblePairings), "Campaign recommendation opportunities"], ["Potential lift", money(primaryOpportunities.reduce((sum, item) => sum + item.incrementalRevenuePaise, 0)), "Current catalog opportunities"], ["Realized uplift", money(realized), "Persisted confirmed merchant orders"], ["Razorpay verified", `${verifiedOrders.length}/${candidates.length}`, "Captured Test Mode orders independently re-read from Razorpay"]].map(([label, value, note]) => <div key={label} style={{ background: "white", border: "1px solid #dddcd7", padding: 18 }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".08em", fontWeight: 700 }}>{label}</div><div style={{ fontSize: 27, fontWeight: 700, marginTop: 9 }}>{value}</div><div style={{ color: "#777", fontSize: 11, marginTop: 5 }}>{note}</div></div>)}
    </section>

    <section style={{ marginTop: 18, background: verificationReady ? "#171717" : "#f1e8e5", color: verificationReady ? "white" : "#6d3a34", padding: 22, border: verificationReady ? "0" : "1px solid #dcc4be" }}>
      <div style={{ fontSize: 10, color: verificationReady ? "#bcbcb8" : "#8d332d", letterSpacing: ".1em", fontWeight: 700 }}>RAZORPAY TEST MODE ATTESTATION</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 20, marginTop: 9 }}><div><h2 style={{ margin: 0, fontSize: 25 }}>{verificationReady ? `${verifiedOrders.length} live payment${verifiedOrders.length === 1 ? "" : "s"} independently verified` : "Live payment verification is locked"}</h2><p style={{ margin: "8px 0 0", color: verificationReady ? "#c9c9c5" : "#6d3a34", fontSize: 12, lineHeight: 1.6, maxWidth: 760 }}>{verificationReady ? "Every verified cohort order has its Razorpay order and payment re-read through the authenticated MCP gateway, with amount and binding checked against the original MANDATE transaction." : "No Razorpay-verified uplift is shown until the merchant runtime has an authenticated MCP connection. This page never substitutes local data for live payment evidence."}</p></div><span style={{ border: `1px solid ${verificationReady ? "#666" : "#c5a59e"}`, padding: "8px 10px", fontSize: 10, fontWeight: 800 }}>{verificationReady ? "LIVE CHECK" : "BLOCKED"}</span></div>
      {verifiedOrders.length > 0 ? <div style={{ marginTop: 15, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>{verifiedOrders.slice(0, 6).map((order) => { const proof = verifiedByTransaction.get(order.transactionId)!; return <div key={order.transactionId} style={{ border: `1px solid ${verificationReady ? "#343434" : "#ddd"}`, padding: 12, background: verificationReady ? "#232323" : "white" }}><div style={{ fontSize: 9, letterSpacing: ".08em", color: verificationReady ? "#aaa" : "#777", fontWeight: 700 }}>CAPTURED · {proof.payment.method ?? "payment"}</div><strong style={{ display: "block", marginTop: 5, fontSize: 13 }}>{money(proof.amountPaise)}</strong><div style={{ marginTop: 4, color: verificationReady ? "#bbb" : "#666", fontSize: 10, wordBreak: "break-all" }}>{proof.orderId} · {proof.paymentId}</div></div>; })}</div> : null}
    </section>

    <section style={{ marginTop: 18, background: "white", border: "1px solid #dddcd7", padding: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 20 }}>
        <div><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>TEST MODE BATCH REVENUE UPLIFT</div><h2 style={{ margin: "7px 0 0", fontSize: 27 }}>{batchOrders.length ? `Latest Razorpay-verified cohort · ${batchOrders.length} orders` : "Waiting for Razorpay-verified orders"}</h2></div>
        <div style={{ textAlign: "right", color: "#666", fontSize: 11 }}>{verifiedOrders.length} verified / {candidates.length} candidates<br />No verified payment → no batch uplift</div>
      </div>
      <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1.25fr .75fr", gap: 22 }}>
        <div><div style={{ display: "grid", gap: 10 }}><BatchBar label="Baseline basket value" amount={batchBasePaise} max={maxBar} note="Persisted originating basket for independently verified orders" /><BatchBar label="Razorpay-verified confirmed revenue" amount={batchRevenuePaise} max={maxBar} note="Confirmed merchant revenue whose payment was re-read from Razorpay Test Mode" /><BatchBar label="Incremental uplift" amount={batchIncrementalPaise} max={maxBar} note={`${batchUpliftedOrders} of ${batchOrders.length} verified orders carried incremental revenue`} /></div></div>
        <div style={{ borderLeft: "1px solid #e2e2de", paddingLeft: 22, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><Stat label="Uplift rate" value={pct(batchUpliftPct)} /><Stat label="Incremental / order" value={moneyExact(batchAverageIncremental)} /><Stat label="Verified uplift" value={money(batchIncrementalPaise)} /><Stat label="Orders uplifted" value={`${batchUpliftedOrders}/${batchOrders.length}`} /></div>
      </div>
      <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={{ borderTop: "1px solid #e6e6e2", paddingTop: 14 }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>REALIZED LIFT DRIVERS</div><div style={{ display: "grid", gap: 8, marginTop: 10 }}>{highestLiftOrders.map((order, index) => { const product = order.productId ? findProduct(order.productId) : null; const label = product?.name ?? (order.lineItems?.[0] ? findProduct(order.lineItems[0].productId)?.name : null) ?? "Confirmed order"; return <div key={order.merchantOrderId} style={{ display: "grid", gridTemplateColumns: "24px 1fr auto", gap: 10, alignItems: "center", fontSize: 12 }}><span style={{ color: "#999", fontFamily: "monospace" }}>{String(index + 1).padStart(2, "0")}</span><strong>{label}</strong><span style={{ color: "#1e5b3e", fontWeight: 700 }}>+{money(order.incrementalRevenuePaise)}</span></div>; })}{highestLiftOrders.length === 0 ? <div style={{ color: "#777", fontSize: 12 }}>No Razorpay-verified uplift orders yet.</div> : null}</div></div>
        <div style={{ borderTop: "1px solid #e6e6e2", paddingTop: 14 }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>EVIDENCE RULE</div><p style={{ margin: "10px 0 0", color: "#666", fontSize: 12, lineHeight: 1.7 }}>Baseline and merchant attribution come from persisted confirmed orders. A batch enters this section only when the corresponding Razorpay order and payment are fetched again, bound to the same transaction, amount-matched, and observed as captured in Test Mode.</p><div style={{ marginTop: 12, padding: 13, border: "1px solid #e1e1dd", background: "#fafaf7", fontFamily: "monospace", fontSize: 11 }}>MANDATE TX → RAZORPAY ORDER → RAZORPAY PAYMENT → CAPTURED → VERIFIED UPLIFT</div></div>
      </div>
    </section>

    {primary ? <section style={{ marginTop: 18, background: "#171717", color: "white", padding: 24 }}><div style={{ fontSize: 10, color: "#bcbcb8", letterSpacing: ".1em", fontWeight: 700 }}>ACTIVE CAMPAIGN</div><div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "end", marginTop: 12 }}><div><h2 style={{ margin: 0, fontSize: 28 }}>{primary.name}</h2><p style={{ maxWidth: 680, color: "#c9c9c5", lineHeight: 1.7, fontSize: 12, margin: "8px 0 0" }}>{primary.objective}</p></div><Link href="http://localhost:3001/golden-path" style={{ color: "white", textDecoration: "none", border: "1px solid #666", padding: "10px 12px", fontSize: 11, fontWeight: 700 }}>Open buyer →</Link></div></section> : null}

    <section style={{ marginTop: 18, background: "white", border: "1px solid #dddcd7", padding: 22 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "end" }}><div><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>CURRENT OPPORTUNITIES</div><h2 style={{ margin: "7px 0 0", fontSize: 27 }}>What the merchant can surface next</h2></div><span style={{ fontSize: 11, color: "#777" }}>{primaryOpportunities.length} opportunities</span></div><div style={{ marginTop: 16, display: "grid", gap: 10 }}>{primaryOpportunities.map((item) => <div key={`${item.sourceProductId}-${item.productId}`} style={{ border: "1px solid #e5e5e1", padding: 15, display: "grid", gridTemplateColumns: "1fr auto", gap: 18 }}><div><div style={{ fontSize: 11, color: "#777" }}>{item.type} · score {item.score.toFixed(1)}</div><div style={{ fontSize: 16, fontWeight: 700, marginTop: 5 }}>{item.sourceProductName} <span style={{ color: "#888" }}>→</span> {item.productName}</div><p style={{ margin: "5px 0 0", color: "#666", fontSize: 12, lineHeight: 1.5 }}>{item.rationale}</p></div><div style={{ textAlign: "right" }}><small style={{ color: "#777" }}>Incremental basket</small><strong style={{ display: "block", marginTop: 5, color: "#1e5b3e" }}>+{money(item.incrementalRevenuePaise)}</strong></div></div>)}</div></section>

    <section style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      <div style={{ background: "white", border: "1px solid #dddcd7", padding: 22 }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>CONTROL LOOP</div><div style={{ marginTop: 14, display: "grid", gap: 10 }}>{["Merchant defines campaign objective", "Recommendation engine ranks eligible pairings", "Buyer presents recommendation", "User explicitly approves basket change", "Fresh merchant quote is generated", "Gateway revalidates and authorizes", "Confirmed order becomes realized revenue"].map((step, index) => <div key={step} style={{ display: "grid", gridTemplateColumns: "28px 1fr", gap: 10, alignItems: "start", fontSize: 12 }}><span style={{ fontFamily: "monospace", color: "#777" }}>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong></div>)}</div></div>
      <div style={{ background: "#fafaf7", border: "1px solid #dddcd7", padding: 22 }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>BOUNDARIES</div><h2 style={{ fontSize: 24, margin: "8px 0 10px" }}>Revenue logic cannot authorize money.</h2><p style={{ color: "#666", fontSize: 12, lineHeight: 1.7 }}>Campaigns and recommendations only create opportunities. They cannot change the user's hard limit, substitute a client-side price, create a Razorpay order, or confirm a merchant order.</p><div style={{ marginTop: 16, padding: 14, background: "white", border: "1px solid #e5e5e1", fontFamily: "monospace", fontSize: 12 }}>CAMPAIGN → BUYER APPROVAL → QUOTE → POLICY → PAYMENT</div></div>
    </section>

    <div style={{ marginTop: 24, color: "#888", fontSize: 11 }}>Potential lift is catalog opportunity. Realized uplift is persisted confirmed revenue. Test Mode uplift is shown only after an independent Razorpay re-read confirms the captured payment.</div>
  </div></main>;
}

function BatchBar({ label, amount, max, note }: { label: string; amount: number; max: number; note: string }) {
  const width = `${Math.max(3, Math.round((amount / max) * 100))}%`;
  return <div><div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "baseline", fontSize: 12 }}><strong>{label}</strong><span style={{ fontWeight: 700 }}>{money(amount)}</span></div><div style={{ height: 10, background: "#e8e6e1", marginTop: 7, overflow: "hidden" }}><div style={{ width, height: "100%", background: "#171717" }} /></div><div style={{ color: "#777", fontSize: 10, marginTop: 5 }}>{note}</div></div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div style={{ border: "1px solid #e2e2de", padding: 13, background: "#fafaf7" }}><div style={{ fontSize: 9, color: "#777", letterSpacing: ".08em", fontWeight: 700 }}>{label}</div><div style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>{value}</div></div>;
}
