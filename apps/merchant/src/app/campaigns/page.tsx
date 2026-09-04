"use client";

import Script from "next/script";
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
type RazorpayOrder = { id: string; amount: number; currency: string };
type RazorpayCheckout = { keyId: string; currency: "INR" };
type CreatedContent = { order?: RazorpayOrder; checkout?: RazorpayCheckout };
type McpResult = { result?: { isError?: boolean; structuredContent?: CreatedContent; content?: Array<{ text?: string }> } };
type Result = Candidate & { ok: boolean; body?: McpResult; error?: string; paymentId?: string; verified?: boolean; status?: string };
type Funnel = { eligibleOpportunities: number; authorizedCandidates: number; razorpayOrdersCreated: number; razorpayVerifiedCaptures: number; confirmedMerchantOrders: number; realizedIncrementalRevenuePaise: number };
type Payload = { testModeOnly: boolean; campaign: Campaign; campaigns: Campaign[]; candidates: Candidate[]; funnel: Funnel; maxBatchSize: number; executionRule: string };
type RazorpayCallback = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };

declare global { interface Window { Razorpay?: new (options: Record<string, unknown>) => { open: () => void } } }

const gateway = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4000";
const money = (paise: number | null) => typeof paise === "number" ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(paise / 100) : "—";

function createdOrder(result: Result): RazorpayOrder | null { return result.body?.result?.structuredContent?.order ?? null; }
function createdCheckout(result: Result): RazorpayCheckout | null { return result.body?.result?.structuredContent?.checkout ?? null; }

export default function CampaignOrchestratorPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [activePayment, setActivePayment] = useState("");
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
    setBusy(true); setError(""); setResults([]); setStatuses({});
    try {
      const response = await fetch("/api/campaign-orchestrator", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaignId: campaign.id, transactionIds: selected }), cache: "no-store" });
      const body = await response.json() as { results?: Result[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Campaign execution failed.");
      const nextResults = body.results ?? [];
      setResults(nextResults);
      setStatuses(Object.fromEntries(nextResults.map((result) => [result.transactionId, result.ok ? "ORDER_CREATED" : result.error ?? "FAILED"])));
      await load(campaign.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Campaign execution failed.");
    } finally { setBusy(false); }
  }

  async function verifyPayment(transactionId: string, callback: RazorpayCallback) {
    setStatuses((current) => ({ ...current, [transactionId]: "VERIFYING_SIGNATURE" }));
    try {
      const response = await fetch(`${gateway}/v1/transactions/${encodeURIComponent(transactionId)}/verify-payment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(callback),
        cache: "no-store",
      });
      const body = await response.json().catch(() => null) as { error?: string; verified?: boolean } | null;
      if (!response.ok) throw new Error(body?.error ?? "Payment verification failed.");
      setStatuses((current) => ({ ...current, [transactionId]: body?.verified ? "PAYMENT_VERIFIED" : "RECONCILING" }));
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const latestResponse = await fetch(`${gateway}/v1/transactions`, { cache: "no-store" });
        if (!latestResponse.ok) continue;
        const latestBody = await latestResponse.json() as { transactions?: Array<{ id: string; state: string }> };
        const latest = latestBody.transactions?.find((item) => item.id === transactionId);
        if (!latest) continue;
        setStatuses((current) => ({ ...current, [transactionId]: latest.state.toUpperCase() }));
        if (["order_confirmed", "payment_failed", "cancelled"].includes(latest.state)) break;
      }
      await load(campaign?.id);
    } catch (caught) {
      setStatuses((current) => ({ ...current, [transactionId]: "VERIFY_FAILED" }));
      setError(caught instanceof Error ? caught.message : "Payment verification failed.");
    } finally { setActivePayment(""); }
  }

  function openRazorpay(result: Result) {
    const order = createdOrder(result);
    const checkout = createdCheckout(result);
    if (!result.ok || !order || !checkout) { setError("No Razorpay Test Mode checkout payload is available for this cohort item."); return; }
    if (!window.Razorpay) { setError("Razorpay Checkout is still loading."); return; }
    setActivePayment(result.transactionId);
    setStatuses((current) => ({ ...current, [result.transactionId]: "CHECKOUT_OPEN" }));
    const instance = new window.Razorpay({
      key: checkout.keyId,
      amount: order.amount,
      currency: checkout.currency,
      name: "Mandate Market",
      description: "Growth campaign cohort",
      order_id: order.id,
      handler: (callback: RazorpayCallback) => void verifyPayment(result.transactionId, callback),
      modal: { ondismiss: () => { setStatuses((current) => ({ ...current, [result.transactionId]: "CHECKOUT_DISMISSED" })); setActivePayment(""); } },
    });
    instance.open();
  }

  const funnel = data?.funnel;
  const uplift = funnel?.realizedIncrementalRevenuePaise ?? 0;
  const readyOrders = results.filter((result) => result.ok && createdOrder(result));
  const confirmed = Object.values(statuses).filter((state) => state === "ORDER_CONFIRMED").length;

  return <>
    <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
    <main style={{ minHeight: "100vh", background: "#f6f6f2", color: "#171717", fontFamily: "Inter, Arial, sans-serif", padding: 36 }}><div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "end", marginBottom: 28 }}><div><div style={{ fontSize: 11, color: "#1e5b3e", letterSpacing: 2, fontWeight: 800 }}>PHASE 7 / REAL TEST MODE CAMPAIGN ORCHESTRATOR</div><h1 style={{ fontSize: 48, lineHeight: 1.02, margin: "8px 0 12px", letterSpacing: "-.04em" }}>Turn a growth recommendation into a measurable payment cohort.</h1><p style={{ maxWidth: 860, color: "#666", lineHeight: 1.6 }}>Campaign logic chooses the opportunity. MANDATE chooses whether a transaction may execute. Razorpay Test Mode is the only payment rail.</p></div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}><a href="/growth" style={{ padding: "10px 12px", border: "1px solid #ccc", color: "#171717", textDecoration: "none", fontSize: 12, fontWeight: 800, textAlign: "center" }}>Growth evidence</a><a href="/growth-batch" style={{ padding: "10px 12px", background: "#171717", color: "white", textDecoration: "none", fontSize: 12, fontWeight: 800, textAlign: "center" }}>Batch console</a></div></header>

      {error ? <div style={{ padding: 14, background: "#f6e9e7", border: "1px solid #dfc1bc", color: "#7b302b", fontSize: 12, marginBottom: 14 }}>{error}</div> : null}

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1.1fr", gap: 18 }}>
        <div style={{ background: "#171717", color: "white", padding: 24 }}><div style={{ fontSize: 10, color: "#aaa", letterSpacing: 1.5, fontWeight: 800 }}>CAMPAIGN STRATEGY</div><div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>{data?.campaigns.map((item) => <button key={item.id} onClick={() => void load(item.id)} style={{ border: `1px solid ${item.id === campaignId ? "white" : "#555"}`, background: item.id === campaignId ? "white" : "transparent", color: item.id === campaignId ? "#171717" : "white", padding: "9px 11px", cursor: "pointer", fontWeight: 800, fontSize: 11 }}>{item.name}</button>)}</div>{campaign ? <><h2 style={{ margin: "22px 0 8px", fontSize: 28 }}>{campaign.name}</h2><p style={{ color: "#ccc", lineHeight: 1.6, fontSize: 13 }}>{campaign.objective}</p><div style={{ marginTop: 18, padding: 14, border: "1px solid #333" }}><div style={{ fontSize: 9, color: "#aaa", letterSpacing: 1.2, fontWeight: 800 }}>ELIGIBLE OPPORTUNITIES</div><div style={{ marginTop: 9, display: "grid", gap: 9 }}>{campaign.opportunities.slice(0, 6).map((opportunity) => <div key={`${opportunity.offerTargetProductId}-${opportunity.sourceProductId}`} style={{ borderTop: "1px solid #333", paddingTop: 9 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><strong style={{ fontSize: 12 }}>{opportunity.productName}</strong><span style={{ color: "#b9d3c2", fontWeight: 800 }}>+{money(opportunity.incrementalRevenuePaise)}</span></div><div style={{ color: "#999", fontSize: 10, marginTop: 4 }}>from {opportunity.sourceProductName} · score {opportunity.score}</div><div style={{ color: "#aaa", fontSize: 10, marginTop: 4, lineHeight: 1.5 }}>{opportunity.rationale}</div></div>)}</div></div></> : null}</div>

        <div style={{ background: "white", border: "1px solid #dddcd7" }}><div style={{ padding: 20, borderBottom: "1px solid #e7e7e3", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "end" }}><div><div style={{ fontSize: 10, color: "#777", letterSpacing: 1.2, fontWeight: 800 }}>REAL TRANSACTION COHORT</div><h2 style={{ margin: "6px 0 0", fontSize: 25 }}>MANDATE-authorized candidates</h2></div><span style={{ fontSize: 10, fontWeight: 800, color: "#1e5b3e" }}>{selected.length}/5 selected</span></div>{!data ? <div style={{ padding: 22, color: "#777" }}>Loading live gateway state…</div> : data.candidates.length === 0 ? <div style={{ padding: 22, color: "#777" }}>No campaign-matching authorized transactions yet. Create one through the buyer negotiation flow first.</div> : <div>{data.candidates.map((candidate) => { const checked = selected.includes(candidate.transactionId); return <label key={candidate.transactionId} style={{ display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 12, padding: 15, borderBottom: "1px solid #eee", background: checked ? "#eef6f1" : "white", cursor: "pointer" }}><input type="checkbox" checked={checked} onChange={() => toggle(candidate.transactionId)} /><div><strong style={{ fontSize: 12 }}>{candidate.productId ?? "Authorized transaction"}</strong><div style={{ color: "#777", fontSize: 10, marginTop: 4, fontFamily: "monospace", wordBreak: "break-all" }}>{candidate.transactionId}</div><div style={{ color: "#777", fontSize: 10, marginTop: 4 }}>MANDATE {candidate.authorizationId} · {candidate.state}</div></div><div style={{ textAlign: "right" }}><strong>{money(candidate.amountPaise)}</strong><div style={{ color: candidate.razorpayOrderId ? "#1e5b3e" : "#777", fontSize: 10, marginTop: 4 }}>{candidate.razorpayOrderId ? "Order exists" : "Order not created"}</div></div></label>; })}</div>}</div>
      </section>

      <section style={{ marginTop: 18, background: "white", border: "1px solid #dddcd7", padding: 20 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "end" }}><div><div style={{ fontSize: 10, color: "#777", letterSpacing: 1.3, fontWeight: 800 }}>REAL TEST MODE CONVERSION FUNNEL</div><h2 style={{ margin: "6px 0 0", fontSize: 25 }}>Opportunity → authorized → paid → realized</h2></div><div style={{ color: "#1e5b3e", fontWeight: 900, fontSize: 22 }}>{money(uplift)} uplift</div></div><div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}><FunnelStep label="Eligible" value={funnel?.eligibleOpportunities ?? 0} /><FunnelStep label="Authorized" value={funnel?.authorizedCandidates ?? 0} /><FunnelStep label="Razorpay orders" value={funnel?.razorpayOrdersCreated ?? 0} /><FunnelStep label="Verified captures" value={funnel?.razorpayVerifiedCaptures ?? 0} /><FunnelStep label="Merchant orders" value={funnel?.confirmedMerchantOrders ?? 0} /><FunnelStep label="Realized uplift" value={money(funnel?.realizedIncrementalRevenuePaise ?? 0)} /></div><div style={{ marginTop: 13, padding: 12, background: "#fafaf7", border: "1px solid #e5e5e1", fontFamily: "monospace", fontSize: 10, color: "#666" }}>COUNTING RULE: an order reaches the final two stages only after the gateway re-reads Razorpay Test Mode and confirms the bound captured payment. No local-only success state is counted.</div></section>

      <section style={{ marginTop: 18, background: "#eff6f1", border: "1px solid #c8d8ce", padding: 18, display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center" }}><div><strong style={{ fontSize: 14 }}>Execution rule</strong><div style={{ color: "#52685b", fontSize: 11, marginTop: 5 }}>{data?.executionRule ?? "Only campaign-matching MANDATE-authorized transactions can create Test Mode orders."}</div>{selectedCandidates.length > 0 ? <div style={{ color: "#1e5b3e", fontSize: 11, marginTop: 6, fontWeight: 700 }}>Selected real cohort value: {money(selectedCandidates.reduce((sum, item) => sum + (item.amountPaise ?? 0), 0))}</div> : null}</div><button disabled={busy || selected.length === 0} onClick={() => void runCampaign()} style={{ border: 0, background: "#171717", color: "white", padding: "13px 16px", fontWeight: 800, cursor: selected.length ? "pointer" : "not-allowed" }}>{busy ? "Creating Test Mode orders…" : "Run campaign cohort →"}</button></section>

      {results.length > 0 ? <section style={{ marginTop: 18, background: "white", border: "1px solid #dddcd7", padding: 20 }}><div style={{ fontSize: 10, letterSpacing: 1.2, color: "#777", fontWeight: 800 }}>EXECUTION EVIDENCE</div><div style={{ marginTop: 12, display: "grid", gap: 8 }}>{results.map((result) => { const order = createdOrder(result); return <div key={result.transactionId} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, alignItems: "center", padding: 13, border: "1px solid #e5e5e1", fontSize: 11 }}><div><div style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{result.transactionId}</div><div style={{ color: "#777", marginTop: 4 }}>{statuses[result.transactionId] ?? (result.ok ? "ORDER_CREATED" : result.error ?? "FAILED")}</div>{order ? <div style={{ color: "#666", marginTop: 4 }}>Razorpay {order.id} · {money(order.amount)}</div> : null}</div>{order ? <strong>{confirmed > 0 ? "" : money(order.amount)}</strong> : <span />}{order ? <button disabled={!result.ok || activePayment !== "" || statuses[result.transactionId] === "ORDER_CONFIRMED"} onClick={() => openRazorpay(result)} style={{ border: 0, background: statuses[result.transactionId] === "ORDER_CONFIRMED" ? "#dfece4" : "#171717", color: statuses[result.transactionId] === "ORDER_CONFIRMED" ? "#1e5b3e" : "white", padding: "10px 12px", fontWeight: 800, cursor: result.ok ? "pointer" : "default" }}>{statuses[result.transactionId] === "ORDER_CONFIRMED" ? "Confirmed" : activePayment === result.transactionId ? "Opening…" : "Pay in Test Mode →"}</button> : <strong style={{ color: "#8d332d" }}>{result.error ?? "FAILED"}</strong>}</div>; })}</div><p style={{ color: "#666", fontSize: 11, lineHeight: 1.6, margin: "12px 0 0" }}>Complete the created orders in Razorpay Test Mode here. Verified payments are then reconciled into the campaign funnel and durable evidence ledger.</p></section> : null}
    </div></main>
  </>;
}

function FunnelStep({ label, value }: { label: string; value: number | string }) { return <div style={{ border: "1px solid #e1e1dd", padding: 14, minHeight: 82, display: "flex", flexDirection: "column", justifyContent: "space-between" }}><div style={{ fontSize: 9, color: "#777", letterSpacing: ".08em", fontWeight: 800 }}>{label}</div><strong style={{ fontSize: 22, marginTop: 8 }}>{value}</strong></div>; }
