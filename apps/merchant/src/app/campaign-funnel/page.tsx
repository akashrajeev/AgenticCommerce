import Link from "next/link";

export const dynamic = "force-dynamic";

const API = "/api/campaign-orchestrator";
const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
const pct = (value: number) => `${value.toFixed(1)}%`;

type Campaign = { id: string; name: string; objective: string; strategy: string };
type Funnel = {
  eligibleOpportunities: number;
  authorizedCandidates: number;
  razorpayOrdersCreated: number;
  razorpayVerifiedCaptures: number;
  confirmedMerchantOrders: number;
  realizedIncrementalRevenuePaise: number;
};
type Payload = { campaign: Campaign; campaigns: Campaign[]; funnel: Funnel; testModeOnly: boolean };

async function load(campaignId?: string): Promise<Payload | null> {
  try {
    const url = campaignId ? `${process.env.MERCHANT_INTERNAL_URL ?? "http://localhost:3000"}${API}?campaignId=${encodeURIComponent(campaignId)}` : `${process.env.MERCHANT_INTERNAL_URL ?? "http://localhost:3000"}${API}`;
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    return await response.json() as Payload;
  } catch { return null; }
}

export default async function CampaignPerformanceCockpit({ searchParams }: { searchParams: Promise<{ campaignId?: string }> }) {
  const params = await searchParams;
  const data = await load(params.campaignId);
  const campaign = data?.campaign;
  const funnel = data?.funnel;
  const campaignList = data?.campaigns ?? [];

  return <main style={{ minHeight: "100vh", background: "#f5f5f2", color: "#171717", fontFamily: "Inter, Arial, sans-serif", padding: "34px 20px 72px" }}><div style={{ maxWidth: 1120, margin: "0 auto" }}>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 20 }}><div><div style={{ fontSize: 10, letterSpacing: ".14em", color: "#1e5b3e", fontWeight: 800 }}>MERCHANT GROWTH · LIVE FUNNEL</div><h1 style={{ fontSize: 50, lineHeight: 1, letterSpacing: "-.05em", margin: "9px 0 12px" }}>Campaign performance cockpit</h1><p style={{ maxWidth: 820, color: "#666", lineHeight: 1.7, margin: 0 }}>Every number below is derived from live merchant state. Razorpay conversion counts only appear after the order and payment are independently verified in Test Mode.</p></div><div style={{ display: "flex", gap: 14 }}><Link href="/campaign-orchestrator" style={{ color: "#171717", fontWeight: 800, textDecoration: "none" }}>← Orchestrator</Link><Link href="/growth-attribution" style={{ color: "#777", textDecoration: "none" }}>Attribution →</Link></div></header>

    <section style={{ marginTop: 24, display: "flex", gap: 8, flexWrap: "wrap" }}>{campaignList.map((item) => <Link key={item.id} href={`/campaign-funnel?campaignId=${encodeURIComponent(item.id)}`} style={{ padding: "9px 12px", border: `1px solid ${item.id === campaign?.id ? "#171717" : "#ddd"}`, background: item.id === campaign?.id ? "#171717" : "white", color: item.id === campaign?.id ? "white" : "#171717", textDecoration: "none", fontSize: 11, fontWeight: 800 }}>{item.name}</Link>)}</section>

    {!data || !campaign || !funnel ? <section style={{ marginTop: 18, background: "#f6e9e7", border: "1px solid #dfc1bc", padding: 22, color: "#7b302b" }}>Campaign funnel is unavailable. Start from the merchant campaign orchestrator and ensure the merchant service is reachable.</section> : <>
      <section style={{ marginTop: 18, background: "#171717", color: "white", padding: 24 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "end" }}><div><div style={{ fontSize: 10, color: "#aaa", letterSpacing: ".12em", fontWeight: 800 }}>ACTIVE CAMPAIGN</div><h2 style={{ margin: "7px 0 0", fontSize: 30 }}>{campaign.name}</h2><p style={{ margin: "8px 0 0", color: "#bbb", lineHeight: 1.5, maxWidth: 720 }}>{campaign.objective}</p></div><span style={{ border: "1px solid #4b4b47", padding: "8px 10px", fontSize: 10, fontWeight: 800 }}>RAZORPAY TEST MODE ONLY</span></div></section>

      <section style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
        <Metric label="Eligible" value={String(funnel.eligibleOpportunities)} note="catalog opportunities" />
        <Metric label="Authorized" value={String(funnel.authorizedCandidates)} note="MANDATE-approved" />
        <Metric label="Razorpay orders" value={String(funnel.razorpayOrdersCreated)} note="Test Mode created" />
        <Metric label="Verified captures" value={String(funnel.razorpayVerifiedCaptures)} note="independently re-read" />
        <Metric label="Confirmed" value={String(funnel.confirmedMerchantOrders)} note="merchant orders" />
        <Metric label="Realized uplift" value={money(funnel.realizedIncrementalRevenuePaise)} note="verified increment" />
      </section>

      <section style={{ marginTop: 14, background: "white", border: "1px solid #dddcd7", padding: 22 }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".12em", fontWeight: 800 }}>CONVERSION FUNNEL</div><div style={{ marginTop: 18, display: "grid", gap: 14 }}>{funnelRow("Eligible opportunity", funnel.eligibleOpportunities, funnel.eligibleOpportunities, "Candidate recommendation from current merchant catalog + inventory")}{funnelRow("MANDATE-authorized", funnel.authorizedCandidates, funnel.eligibleOpportunities, "User/agent spending authority and policy passed")}{funnelRow("Razorpay Test Mode order", funnel.razorpayOrdersCreated, funnel.authorizedCandidates, "Bound order created from the trusted transaction")}{funnelRow("Captured + independently verified", funnel.razorpayVerifiedCaptures, funnel.razorpayOrdersCreated, "Payment and order re-read from Razorpay Test Mode")}{funnelRow("Confirmed merchant order", funnel.confirmedMerchantOrders, funnel.razorpayVerifiedCaptures, "Gateway reconciliation reached order confirmation")}</div></section>

      <section style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}><Stat label="Authorization rate" value={pct(funnel.eligibleOpportunities ? funnel.authorizedCandidates / funnel.eligibleOpportunities * 100 : 0)} /><Stat label="Verified capture rate" value={pct(funnel.razorpayOrdersCreated ? funnel.razorpayVerifiedCaptures / funnel.razorpayOrdersCreated * 100 : 0)} /><Stat label="Order confirmation rate" value={pct(funnel.razorpayVerifiedCaptures ? funnel.confirmedMerchantOrders / funnel.razorpayVerifiedCaptures * 100 : 0)} /></section>

      <section style={{ marginTop: 14, background: "white", border: "1px solid #dddcd7", padding: 22 }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".12em", fontWeight: 800 }}>MEASUREMENT RULE</div><p style={{ margin: "9px 0 0", color: "#666", lineHeight: 1.7, fontSize: 12 }}>Potential recommendation value is separate from realized revenue. Realized incremental uplift is included only from merchant orders whose Razorpay order/payment identifiers are independently verified and observed as captured in Test Mode. Funnel percentages describe operational conversion and are not causal marketing attribution.</p><div style={{ marginTop: 12, fontFamily: "monospace", background: "#f8f8f5", border: "1px solid #e6e6e1", padding: 13, fontSize: 11 }}>CAMPAIGN → MANDATE → RAZORPAY TEST ORDER → CAPTURE → MERCHANT ORDER → REALIZED UPLIFT</div></section>
    </>}
  </div></main>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <div style={{ background: "white", border: "1px solid #dddcd7", padding: 14 }}><div style={{ fontSize: 9, color: "#777", letterSpacing: ".1em", fontWeight: 800 }}>{label}</div><strong style={{ display: "block", fontSize: 24, marginTop: 7 }}>{value}</strong><div style={{ color: "#777", fontSize: 9, marginTop: 4 }}>{note}</div></div>; }
function Stat({ label, value }: { label: string; value: string }) { return <div style={{ background: "#171717", color: "white", padding: 18 }}><div style={{ color: "#aaa", fontSize: 9, letterSpacing: ".1em", fontWeight: 800 }}>{label}</div><strong style={{ display: "block", fontSize: 28, marginTop: 6 }}>{value}</strong></div>; }
function funnelRow(label: string, value: number, previous: number, note: string) { const ratio = previous > 0 ? Math.min(value / previous, 1) : 0; return <div style={{ display: "grid", gridTemplateColumns: "230px 70px 1fr 65px", gap: 12, alignItems: "center" }}><strong style={{ fontSize: 12 }}>{label}</strong><strong style={{ fontFamily: "monospace" }}>{value}</strong><div style={{ height: 14, background: "#ecebe6", overflow: "hidden" }}><div style={{ height: "100%", width: `${ratio * 100}%`, background: "#1e5b3e" }} /></div><span style={{ textAlign: "right", color: "#666", fontSize: 10 }}>{pct(ratio * 100)}</span><div style={{ gridColumn: "2 / -1", color: "#777", fontSize: 10 }}>{note}</div></div>; }
