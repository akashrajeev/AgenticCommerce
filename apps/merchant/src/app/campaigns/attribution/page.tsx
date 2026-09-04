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

type Proof = { verified: true; testMode: true; amountPaise: number; orderId: string; paymentId: string; order?: { notes?: Record<string, string>; status?: string } ; payment?: { status?: string; method?: string | null } };
type Evidence = { evidenceId: string; campaignId: string; transactionId: string; razorpayOrderId: string; razorpayPaymentId: string; amountPaise: number; currency: string; orderNotes?: Record<string, string>; verifiedAt: string };
type McpResponse = { result?: { isError?: boolean; structuredContent?: Proof | { evidence?: Evidence[] } } };

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

async function callEvidenceTool(campaignId?: string): Promise<Evidence[]> {
  if (!MCP_AGENT_TOKEN) return [];
  try {
    const response = await fetch(`${MCP_INTERNAL_URL}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${MCP_AGENT_TOKEN}`,
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
        "mcp-name": "mandate_campaign_payment_evidence",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `campaign-ledger-${campaignId ?? "all"}`,
        method: "tools/call",
        params: { name: "mandate_campaign_payment_evidence", arguments: campaignId ? { campaignId } : {} },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.json().catch(() => null) as McpResponse | null;
    const structured = body?.result?.structuredContent;
    if (!response.ok || body?.result?.isError === true || !structured || !("evidence" in structured)) return [];
    return Array.isArray(structured.evidence) ? structured.evidence : [];
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
    return response.ok && body?.result?.isError !== true && proof && "verified" in proof && proof.verified === true && proof.testMode === true ? proof as Proof : null;
  } catch {
    return null;
  }
}

export default async function CampaignAttributionPage() {
  const [orders, ledger] = await Promise.all([loadOrders(), callEvidenceTool()]);
  const verified = (await Promise.all(orders.slice(0, 25).map(async (order) => ({ order, proof: await verify(order) })))).filter((item): item is { order: Order; proof: Proof } => Boolean(item.proof));
  const ledgerByTransaction = new Map(ledger.map((item) => [item.transactionId, item]));

  const campaignRows = growthCampaigns.map((campaign) => {
    const attributed = verified.filter(({ proof }) => proof.order?.notes?.growth_campaign_id === campaign.id);
    const persisted = attributed.filter(({ order }) => ledgerByTransaction.has(order.transactionId));
    const incremental = attributed.reduce((sum, item) => sum + item.order.incrementalRevenuePaise, 0);
    const base = attributed.reduce((sum, item) => sum + item.order.baseAmountPaise, 0);
    return { campaign, attributed, persisted, incremental, base, upliftPct: base > 0 ? (incremental / base) * 100 : 0 };
  });

  const unattributed = verified.filter(({ proof }) => {
    const campaignId = proof.order?.notes?.growth_campaign_id;
    return !campaignId || !growthCampaigns.some((campaign) => campaign.id === campaignId);
  });

  const verifiedLedger = ledger.filter((entry) => entry.currency === "INR");
  const ledgerUplift = verified.reduce((sum, item) => ledgerByTransaction.has(item.order.transactionId) ? sum + item.order.incrementalRevenuePaise : sum, 0);

  return <main style={{ minHeight: "100vh", background: "#f7f7f3", color: "#171717", fontFamily: "Inter, Arial, sans-serif", padding: "36px 20px 72px" }}><div style={{ maxWidth: 1180, margin: "0 auto" }}>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 20, marginBottom: 28 }}><div><div style={{ fontSize: 11, color: "#1e5b3e", letterSpacing: ".12em", fontWeight: 800 }}>MERCHANT GROWTH / ATTRIBUTION</div><h1 style={{ fontSize: 48, lineHeight: 1.02, letterSpacing: "-.04em", margin: "8px 0 10px" }}>Which campaign actually created the uplift?</h1><p style={{ maxWidth: 820, color: "#666", lineHeight: 1.6 }}>Only Razorpay Test Mode captured payments independently re-read through the MCP verification boundary are eligible. Campaign ownership comes from the exact growth campaign ID stored on the Razorpay order, while the durable evidence ledger records the same verified payment for restart-safe audit.</p></div><div style={{ display: "flex", gap: 8 }}><Link href="/campaigns" style={{ border: "1px solid #ccc", padding: "10px 12px", color: "#171717", textDecoration: "none", fontSize: 11, fontWeight: 800 }}>Campaign orchestrator</Link><Link href="/growth" style={{ background: "#171717", color: "white", padding: "10px 12px", textDecoration: "none", fontSize: 11, fontWeight: 800 }}>Growth dashboard</Link></div></header>

    <section style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 16 }}>
      {[["Verified payments", String(verified.length), "Razorpay Test Mode captured + independently re-read"], ["Campaign-attributed", String(verified.length - unattributed.length), "Orders with an exact Razorpay growth campaign ID"], ["Ledger-backed", String(verifiedLedger.length), "Verified campaign payments durably persisted"], ["Unassigned", String(unattributed.length), "Valid payment evidence excluded from campaign uplift"], ["Verified uplift", money(ledgerUplift), "Incremental revenue backed by both live re-read and durable evidence"]].map(([label, value, note]) => <div key={label} style={{ background: "white", border: "1px solid #dddcd7", padding: 18 }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".08em", fontWeight: 800 }}>{label}</div><div style={{ fontSize: 27, fontWeight: 800, marginTop: 8 }}>{value}</div><div style={{ color: "#777", fontSize: 10, lineHeight: 1.4, marginTop: 5 }}>{note}</div></div>)}
    </section>

    <section style={{ marginBottom: 16, background: "#171717", color: "white", border: "1px solid #171717", padding: 18 }}><div style={{ fontSize: 10, color: "#aaa", letterSpacing: ".1em", fontWeight: 800 }}>DURABLE TEST MODE EVIDENCE LEDGER</div><div style={{ marginTop: 7, fontSize: 21, fontWeight: 800 }}>{verifiedLedger.length} campaign payment{verifiedLedger.length === 1 ? "" : "s"} persisted after independent Razorpay verification.</div><div style={{ marginTop: 6, color: "#bbb", fontSize: 11, lineHeight: 1.6 }}>The ledger stores campaign ID, transaction ID, Razorpay order/payment IDs, captured amount and verification time. A local attribution calculation cannot create a ledger entry.</div></section>

    <section style={{ background: "white", border: "1px solid #dddcd7" }}><div style={{ padding: 18, borderBottom: "1px solid #e7e7e3" }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 800 }}>REALIZED CAMPAIGN RESULTS</div><h2 style={{ margin: "7px 0 0", fontSize: 25 }}>Razorpay-verified uplift by campaign</h2></div><div>{campaignRows.map(({ campaign, attributed, persisted, incremental, upliftPct }) => <div key={campaign.id} style={{ display: "grid", gridTemplateColumns: "1.1fr .7fr .7fr .6fr .6fr", gap: 14, alignItems: "center", padding: 18, borderBottom: "1px solid #eee" }}><div><strong>{campaign.name}</strong><div style={{ color: "#777", fontSize: 10, marginTop: 4 }}>{campaign.objective}</div><div style={{ color: "#777", fontSize: 10, marginTop: 4 }}>{campaign.strategy} · {getCampaignOpportunities(campaign).length} live opportunity pairings</div></div><div><div style={{ fontSize: 10, color: "#777" }}>VERIFIED</div><strong>{attributed.length}</strong></div><div><div style={{ fontSize: 10, color: "#777" }}>LEDGERED</div><strong>{persisted.length}</strong></div><div><div style={{ fontSize: 10, color: "#777" }}>REALIZED LIFT</div><strong style={{ color: "#1e5b3e" }}>+{money(incremental)}</strong></div><div><div style={{ fontSize: 10, color: "#777" }}>UPLIFT RATE</div><strong>{pct(upliftPct)}</strong></div></div>)}</div></section>

    <section style={{ marginTop: 16, background: "#171717", color: "white", padding: 20 }}><div style={{ fontSize: 10, letterSpacing: ".1em", color: "#aaa", fontWeight: 800 }}>EVIDENCE CHAIN</div><div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>{["MANDATE TX", "RAZORPAY ORDER", "RAZORPAY PAYMENT", "TEST MODE CAPTURE", "DURABLE LEDGER"].map((step) => <div key={step} style={{ border: "1px solid #333", padding: 12, fontSize: 9, letterSpacing: ".08em", fontWeight: 800, color: step === "DURABLE LEDGER" ? "#d3e5d9" : "#ccc" }}>{step}</div>)}</div><p style={{ maxWidth: 900, color: "#ccc", fontSize: 12, lineHeight: 1.7, margin: "12px 0 0" }}>Campaign uplift is eligible only after the same transaction is authorized by MANDATE, paid in Razorpay Test Mode, independently re-read by the verifier, and persisted in the evidence ledger.</p></section>

    {unattributed.length > 0 ? <section style={{ marginTop: 16, background: "#fffaf7", border: "1px solid #ead6ce", padding: 18 }}><strong style={{ color: "#7b302b" }}>Not attributed: {unattributed.length}</strong><div style={{ color: "#7b302b", fontSize: 11, marginTop: 5 }}>These captured Test Mode payments are real evidence but do not carry a recognized growth campaign ID, so they are intentionally excluded from campaign uplift.</div></section> : null}
  </div></main>;
}
