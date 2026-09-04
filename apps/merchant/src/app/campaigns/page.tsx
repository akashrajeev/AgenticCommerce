"use client";

import { useEffect, useMemo, useState } from "react";

type Opportunity = {
  offerTargetProductId: string;
  sourceProductId: string;
  sourceProductName: string;
  productName: string;
  score: number;
  rationale: string;
  incrementalRevenuePaise: number;
};

type Campaign = { id: string; name: string; objective: string; strategy: string; opportunities: Opportunity[] };
type Candidate = { transactionId: string; authorizationId: string; productId: string | null; amountPaise: number | null; state: string; razorpayOrderId: string | null; razorpayPaymentId?: string | null };
type Result = Candidate & { ok: boolean; body?: unknown; error?: string };
type Funnel = { eligibleOpportunities: number; authorizedCandidates: number; razorpayOrdersCreated: number; razorpayVerifiedCaptures: number; confirmedMerchantOrders: number; realizedIncrementalRevenuePaise: number };
type Payload = { testModeOnly: boolean; campaign: Campaign; campaigns: Campaign[]; candidates: Candidate[]; funnel: Funnel; maxBatchSize: number; executionRule: string };

const money = (paise: number | null) => typeof paise === "number" ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(paise / 100) : "—";

export default function CampaignOrchestratorPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load(nextCampaignId?: string) {
    setError("");
    try {
      const query = nextCampaignId ? `?campaignId=${encodeURIComponent(nextCampaignId)}` : "";
      const response = await fetch(`/api/campaign-orchestrator${query}`, { cache: "no-store" });
      const body = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Campaign orchestrator unavailable.");
      setData(body);
      setCampaignId(body.campaign.id);
      setSelected([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Campaign orchestrator unavailable.");
    }
  }

  useEffect(() => { void load(); }, []);

  const campaign = data?.campaign ?? null;
  const selectedCandidates = useMemo(() => data?.candidates.filter((candidate) => selected.includes(candidate.transactionId)) ?? [], [data, selected]);

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 5 ? [...current, id] : current);
  }

  async function runCampaign() {
    if (!campaign || selected.length === 0) return;
    setBusy(true); setError(""); setResults([]);
    try {
      const response = await fetch("/api/campaign-orchestrator", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaignId: campaign.id, transactionIds: selected }), cache: "no-store" });
      const body = await response.json() as { results?: Result[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Campaign execution failed.");
      setResults(body.results ?? []);
      await load(campaign.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Campaign execution failed.");
    } finally { setBusy(false); }
  }

  const funnel = data?.funnel;
  const uplift = funnel?.realizedIncrementalRevenuePaise ?? 0;

  return <main style={{ minHeight: "100vh", background: "#f6f6f2", color: "#171717", fontFamily: "Inter, Arial, sans-serif", padding: 36 }}><div style={{ maxWidth: 1180, margin: "0 auto" }}>
    <header style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "end", marginBottom: 28 }}><div><div style={{ fontSize: 11, color: "#1e5b3e", letterSpacing: 2, fontWeight: 800 }}>PHASE 7 / REAL TEST MODE CAMPAIGN ORCHESTRATOR</div><h1 style={{ fontSize: 48, lineHeight: 1.02, margin: "8px 0 12px", letterSpacing: "-.04em" }}>Turn a growth recommendation into a measurable payment cohort.</h1><p style={{ maxWidth: 860, color: "#666", lineHeight: 1.6 }}>Campaign logic chooses the opportunity. MANDATE chooses whether a transaction may execute. Razorpay Test Mode is the only payment rail.</p></div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}><a href="/growth" style={{ padding: "10px 12px", border: "1px solid #ccc", color: "#171717", textDecoration: "none", fontSize: 12, fontWeight: 800, textAlign: "center" }}>Growth evidence</a><a href="/growth-batch" style={{ padding: "10px 12px", background: "#171717", color: "white", textDecoration: "none", fontSize: 12, fontWeight: 800, textAlign: "center" }}>Batch console</a></div></header>

    {error ? <div style={{ padding: 14, background: "#f6e9e7", border: "1px solid #dfc1bc", color: "#7b302b", fontSize: 12, marginBottom: 14 }}>{error}</div> : null}

    <section style={{ display: "grid", gridTemplateColumns: "1fr 1.1fr", gap: 18 }}>
      <div style={{ background: "#171717", color: "white", padding: 24 }}><div style={{ fontSize: 10, color: "#aaa", letterSpacing: 1.5, fontWeight: 800 }}>CAMPAIGN STRATEGY</div><div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>{data?.campaigns.map((item) => <button key={item.id} onClick={() => void load(item.id)} style={{ border: `1px solid ${item.id === campaignId ? "white" : "#555"}`, background: item.id === campaignId ? "white" : "transparent", color: item.id === campaignId ? "#171717" : "white", padding: "9px 11px", cursor: "pointer", fontWeight: 800, fontSize: 11 }}>{item.name}</button>)}</div>{campaign ? <><h2 style={{ margin: "22px 0 8px", fontSize: 28 }}>{campaign.name}</h2><p style={{ color: "#ccc", lineHeight: 1.6, fontSize: 13 }}>{campaign.objective}</p><div style={{ marginTop: 18, padding: 14, border: "1px solid #333" }}><div style={{ fontSize: 9, color: "#aaa", letterSpacing: 1.2, fontWeight: 800 }}>ELIGIBLE OPPORTUNITIES</div><div style={{ marginTop: 9, display: "grid", gap: 9 }}>{campaign.opportunities.slice(0, 6).map((opportunity) => <div key={`${opportunity.offerTargetProductId}-${opportunity.sourceProductId}`} style={{ borderTop: "1px solid #333", paddingTop: 9 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><strong style={{ fontSize: 12 }}>{opportunity.productName}</strong><span style={{ color: "#b9d3c2", fontWeight: 800 }}>+{money(opportunity.incrementalRevenuePaise)}</span></div><div style={{ color: "#999", fontSize: 10, marginTop: 4 }}>from {opportunity.sourceProductName} · score {opportunity.score}</div><div style={{ color: "#aaa", fontSize: 10, marginTop: 4, lineHeight: 1.5 }}>{opportunity.rationale}</div></div>)}</div></div></> : null}</div>

      <div style={{ background: "white", border: "1px solid #dddcd7" }}><div style={{ padding: 20, borderBottom: "1px solid #e7e7e3", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "end" }}><div><div style={{ fontSize: 10, color: "#777", letterSpacing: 1.2, fontWeight: 800 }}>REAL TRANSACTION COHORT</div><h2 style={{ margin: "6px 0 0", fontSize: 25 }}>MANDATE-authorized candidates</h2></div><span style={{ fontSize: 10, fontWeight: 800, color: "#1e5b3e" }}>{selected.length}/5 selected</span></div>{!data ? <div style={{ padding: 22, color: "#777" }}>Loading live gateway state…</div> : data.candidates.length === 0 ? <div style={{ padding: 22, color: "#777" }}>No campaign-matching authorized transactions yet. Create one through the buyer negotiation flow first.</div> : <div>{data.candidates.map((candidate) => { const checked = selected.includes(candidate.transactionId); return <label key={candidate.transactionId} style={{ display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 12, padding: 15, borderBottom: "1px solid #eee", background: checked ? "#eef6f1" : "white", cursor: "pointer" }}><input type="checkbox" checked={checked} onChange={() => toggle(candidate.transactionId)} /><div><strong style={{ fontSize: 12 }}>{candidate.productId ?? "Authorized transaction"}</strong><div style={{ color: "#777", fontSize: 10, marginTop: 4, fontFamily: "monospace", wordBreak: "break-all" }}>{candidate.transactionId}</div><div style={{ color: "#777", fontSize: 10, marginTop: 4 }}>MANDATE {candidate.authorizationId} · {candidate.state}</div></div><div style={{ textAlign: "right" }}><strong>{money(candidate.amountPaise)}</strong><div style={{ color: candidate.razorpayOrderId ? "#1e5b3e" : "#777", fontSize: 10, marginTop: 4 }}>{candidate.razorpayOrderId ? "Order exists" : "Order not created"}</div></div></label>; })}</div>}</div>
    </section>

    <section style={{ marginTop: 18, background: "white", border: "1px solid #dddcd7", padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "end" }}><div><div style={{ fontSize: 10, color: "#777", letterSpacing: 1.3, fontWeight: 800 }}>REAL TEST MODE CONVERSION FUNNEL</div><h2 style={{ margin: "6px 0 0", fontSize: 25 }}>Opportunity → authorized → paid → realized</h2></div><div style={{ color: "#1e5b3e", fontWeight: 900, fontSize: 22 }}>{money(uplift)} uplift</div></div>
      <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
        <FunnelStep label="Eligible" value={funnel?.eligibleOpportunities ?? 0} />
        <FunnelStep label="Authorized" value={funnel?.authorizedCandidates ?? 0} />
        <FunnelStep label="Razorpay orders" value={funnel?.razorpayOrdersCreated ?? 0} />
        <FunnelStep label="Verified captures" value={funnel?.razorpayVerifiedCaptures ?? 0} />
        <FunnelStep label="Merchant orders" value={funnel?.confirmedMerchantOrders ?? 0} />
        <FunnelStep label="Realized uplift" value={money(funnel?.realizedIncrementalRevenuePaise ?? 0)} />
      </div>
      <div style={{ marginTop: 13, padding: 12, background: "#fafaf7", border: "1px solid #e5e5e1", fontFamily: "monospace", fontSize: 10, color: "#666" }}>COUNTING RULE: an order reaches the final two stages only after the gateway re-reads Razorpay Test Mode and confirms the bound captured payment. No local-only success state is counted.</div>
    </section>

    <section style={{ marginTop: 18, background: "#eff6f1", border: "1px solid #c8d8ce", padding: 18, display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center" }}><div><strong style={{ fontSize: 14 }}>Execution rule</strong><div style={{ color: "#52685b", fontSize: 11, marginTop: 5 }}>{data?.executionRule ?? "Only campaign-matching MANDATE-authorized transactions can create Test Mode orders."}</div>{selectedCandidates.length > 0 ? <div style={{ color: "#1e5b3e", fontSize: 11, marginTop: 6, fontWeight: 700 }}>Selected real cohort value: {money(selectedCandidates.reduce((sum, item) => sum + (item.amountPaise ?? 0), 0))}</div> : null}</div><button disabled={busy || selected.length === 0} onClick={() => void runCampaign()} style={{ border: 0, background: "#171717", color: "white", padding: "13px 16px", fontWeight: 800, cursor: selected.length ? "pointer" : "not-allowed" }}>{busy ? "Creating Test Mode orders…" : "Run campaign cohort →"}</button></section>

    {results.length > 0 ? <section style={{ marginTop: 18, background: "white", border: "1px solid #dddcd7", padding: 20 }}><div style={{ fontSize: 10, letterSpacing: 1.2, color: "#777", fontWeight: 800 }}>EXECUTION EVIDENCE</div><div style={{ marginTop: 12, display: "grid", gap: 8 }}>{results.map((result) => <div key={result.transactionId} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: 13, border: "1px solid #e5e5e1", fontSize: 11 }}><span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{result.transactionId}</span><strong style={{ color: result.ok ? "#1e5b3e" : "#8d332d" }}>{result.ok ? "TEST MODE ORDER CREATED" : result.error ?? "FAILED"}</strong></div>)}</div><p style={{ color: "#666", fontSize: 11, lineHeight: 1.6, margin: "12px 0 0" }}>Complete the created orders in Razorpay Test Mode Checkout. Then return to <a href="/growth">/growth</a>; only captured payments independently re-read from Razorpay enter realized uplift.</p></section> : null}
  </div></main>;
}

function FunnelStep({ label, value }: { label: string; value: number | string }) { return <div style={{ border: "1px solid #e1e1dd", padding: 14, minHeight: 82, display: "flex", flexDirection: "column", justifyContent: "space-between" }}><div style={{ fontSize: 9, color: "#777", letterSpacing: ".08em", fontWeight: 800 }}>{label}</div><strong style={{ fontSize: 22, marginTop: 8 }}>{value}</strong></div>; }
