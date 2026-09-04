"use client";

import Script from "next/script";
import { useEffect, useState } from "react";

type Candidate = { transactionId: string; authorizationId: string; amountPaise: number | null; currency: string; state: string; merchantId: string | null; productId: string | null; razorpayOrderId: string | null };
type RazorpayOrder = { id: string; amount: number; currency: string };
type RazorpayCheckout = { keyId: string; currency: "INR" };
type BatchResult = { transactionId: string; campaignId?: string; ok: boolean; body?: unknown; error?: string; order?: RazorpayOrder; checkout?: RazorpayCheckout };
type TransactionSnapshot = { id: string; state: string; razorpayOrderId?: string; razorpayPaymentId?: string };

declare global { interface Window { Razorpay?: new (options: Record<string, unknown>) => { open: () => void } } }

const gateway = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4000";
const money = (paise: number | null) => typeof paise === "number" ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100) : "—";
const campaignLabels: Record<string, string> = { "headphone-aov": "Headphone AOV lift", "desk-setup-aov": "Desk setup expansion" };

export default function GrowthBatchPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [campaigns, setCampaigns] = useState<string[]>(Object.keys(campaignLabels));
  const [campaignId, setCampaignId] = useState("headphone-aov");
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<BatchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [activeTransaction, setActiveTransaction] = useState("");
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/growth-batch", { cache: "no-store" });
      const body = await response.json() as { candidates?: Candidate[]; campaigns?: string[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to load batch candidates.");
      setCandidates(body.candidates ?? []);
      if (Array.isArray(body.campaigns) && body.campaigns.length) { setCampaigns(body.campaigns); if (!body.campaigns.includes(campaignId)) setCampaignId(body.campaigns[0]); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load batch candidates."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function createOrders() {
    setRunning(true); setError("");
    try {
      const response = await fetch("/api/growth-batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactionIds: selected, campaignId }), cache: "no-store" });
      const body = await response.json() as { results?: BatchResult[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Batch request failed.");
      const nextResults = body.results ?? [];
      setResults(nextResults);
      setStatuses(Object.fromEntries(nextResults.map((result) => [result.transactionId, result.ok ? "ORDER_CREATED" : result.error ?? "FAILED"])));
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Batch request failed."); }
    finally { setRunning(false); }
  }

  function toggle(id: string) { setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 5 ? [...current, id] : current); }

  async function pollTransaction(transactionId: string) {
    const terminal = new Set(["order_confirmed", "payment_failed", "cancelled"]);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        const response = await fetch(`${gateway}/v1/transactions`, { cache: "no-store" });
        if (!response.ok) continue;
        const body = await response.json() as { transactions?: TransactionSnapshot[] };
        const latest = body.transactions?.find((item) => item.id === transactionId);
        if (!latest) continue;
        setStatuses((current) => ({ ...current, [transactionId]: latest.state.toUpperCase() }));
        if (terminal.has(latest.state)) return latest;
      } catch { /* bounded polling; transaction remains visible */ }
    }
    setStatuses((current) => ({ ...current, [transactionId]: "RECONCILIATION_PENDING" }));
    return null;
  }

  function openRazorpay(result: BatchResult) {
    if (!result.ok || !result.order || !result.checkout) return;
    if (!window.Razorpay) { setError("Razorpay Checkout is still loading."); return; }
    setActiveTransaction(result.transactionId);
    setStatuses((current) => ({ ...current, [result.transactionId]: "CHECKOUT_OPEN" }));
    const instance = new window.Razorpay({
      key: result.checkout.keyId, amount: result.order.amount, currency: result.checkout.currency,
      name: "Mandate Market", description: `${campaignLabels[result.campaignId ?? campaignId] ?? "Merchant growth"} · Test cohort`, order_id: result.order.id,
      handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
        setStatuses((current) => ({ ...current, [result.transactionId]: "VERIFYING_SIGNATURE" }));
        try {
          const verify = await fetch(`${gateway}/v1/transactions/${encodeURIComponent(result.transactionId)}/verify-payment`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(response), cache: "no-store" });
          const body = await verify.json().catch(() => null) as { error?: string; verified?: boolean } | null;
          if (!verify.ok) throw new Error(body?.error ?? "Payment verification failed.");
          setStatuses((current) => ({ ...current, [result.transactionId]: body?.verified ? "PAYMENT_VERIFIED" : "RECONCILING" }));
          const latest = await pollTransaction(result.transactionId);
          if (latest?.state === "order_confirmed") setStatuses((current) => ({ ...current, [result.transactionId]: "ORDER_CONFIRMED" }));
          else if (latest?.state === "payment_failed") setStatuses((current) => ({ ...current, [result.transactionId]: "PAYMENT_FAILED" }));
        } catch (caught) { setStatuses((current) => ({ ...current, [result.transactionId]: "VERIFY_FAILED" })); setError(caught instanceof Error ? caught.message : "Payment verification failed."); }
        finally { setActiveTransaction(""); }
      },
      modal: { ondismiss: () => { setStatuses((current) => ({ ...current, [result.transactionId]: "CHECKOUT_DISMISSED" })); setActiveTransaction(""); } },
    });
    instance.open();
  }

  const successfulOrders = results.filter((result) => result.ok && result.order && result.checkout);
  const confirmedCount = successfulOrders.filter((result) => statuses[result.transactionId] === "ORDER_CONFIRMED").length;
  const pendingPaymentCount = successfulOrders.filter((result) => !["ORDER_CONFIRMED", "PAYMENT_FAILED"].includes(statuses[result.transactionId] ?? "")).length;

  return <>
    <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
    <main style={{ minHeight: "100vh", background: "#f5f5f2", color: "#171717", fontFamily: "Arial, sans-serif", padding: 36 }}><div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 24 }}><div><div style={{ fontSize: 11, color: "#1e5b3e", letterSpacing: ".12em", fontWeight: 800 }}>TEST MODE · GROWTH BATCH</div><h1 style={{ fontSize: 50, lineHeight: 1, letterSpacing: "-.05em", margin: "10px 0" }}>Create and prove a real payment cohort.</h1><p style={{ maxWidth: 780, color: "#666", lineHeight: 1.7, margin: 0 }}>Select existing MANDATE-authorized transactions, assign the cohort to a merchant campaign, create real Razorpay Test Mode orders through MCP, complete them in Razorpay Checkout, and reconcile every result before it can contribute to merchant growth evidence.</p></div><a href="/growth" style={{ color: "#171717", fontWeight: 700, textDecoration: "none" }}>← Growth dashboard</a></header>

      <section style={{ marginTop: 24, background: "white", border: "1px solid #dddcd7", padding: 18, display: "grid", gridTemplateColumns: "1fr auto", gap: 18, alignItems: "end" }}><div><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 800 }}>CAMPAIGN</div><label style={{ display: "block", marginTop: 7, fontWeight: 800 }} htmlFor="campaign">Attribute this Test Mode cohort to</label><select id="campaign" value={campaignId} onChange={(event) => setCampaignId(event.target.value)} style={{ marginTop: 8, padding: "10px 12px", minWidth: 280, border: "1px solid #ccc", background: "white", fontWeight: 700 }}>{campaigns.map((id) => <option key={id} value={id}>{campaignLabels[id] ?? id}</option>)}</select></div><div style={{ color: "#666", fontSize: 11, textAlign: "right", maxWidth: 380 }}>The campaign ID is written into the Razorpay Test Mode order attribution. Only independently verified captured payments can become realized uplift.</div></section>

      <section style={{ marginTop: 14, display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", background: "#171717", color: "white", padding: 18 }}><div><strong>{selected.length}/5 selected</strong><div style={{ color: "#bbb", fontSize: 11, marginTop: 4 }}>Only policy-authorized transactions are selectable. No model-supplied amount enters this path.</div></div><button disabled={running || selected.length === 0} onClick={() => void createOrders()} style={{ border: 0, background: "white", color: "#171717", padding: "11px 14px", fontWeight: 800, cursor: selected.length ? "pointer" : "not-allowed" }}>{running ? "Creating…" : `Create ${campaignLabels[campaignId] ?? "campaign"} Test Mode orders →`}</button></section>

      {error ? <div style={{ marginTop: 14, padding: 14, border: "1px solid #dfc1bc", background: "#f6e9e7", color: "#7b302b", fontSize: 12 }}>{error}</div> : null}

      <section style={{ marginTop: 14, background: "white", border: "1px solid #dddcd7" }}><div style={{ padding: 18, borderBottom: "1px solid #e8e7e2" }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 800 }}>REAL CANDIDATES</div><h2 style={{ margin: "7px 0 0", fontSize: 25 }}>Policy-authorized transactions</h2></div>{loading ? <div style={{ padding: 22, color: "#777" }}>Loading live gateway state…</div> : candidates.length === 0 ? <div style={{ padding: 22, color: "#777" }}>No authorized transactions yet. Run the flagship negotiation flow first.</div> : <div>{candidates.map((candidate) => { const checked = selected.includes(candidate.transactionId); return <label key={candidate.transactionId} style={{ display: "grid", gridTemplateColumns: "32px 1fr auto", gap: 14, alignItems: "center", padding: 16, borderBottom: "1px solid #eee", background: checked ? "#f0f6f2" : "white", cursor: "pointer" }}><input type="checkbox" checked={checked} onChange={() => toggle(candidate.transactionId)} /><div><div style={{ fontWeight: 800 }}>{candidate.productId ?? "Transaction"}</div><div style={{ color: "#777", fontSize: 10, marginTop: 4, fontFamily: "monospace", wordBreak: "break-all" }}>{candidate.transactionId}</div><div style={{ color: "#777", fontSize: 10, marginTop: 4 }}>{candidate.merchantId ?? "merchant"} · {candidate.state} · MANDATE {candidate.authorizationId}</div></div><div style={{ textAlign: "right" }}><strong>{money(candidate.amountPaise)}</strong><div style={{ color: candidate.razorpayOrderId ? "#1e5b3e" : "#777", fontSize: 10, marginTop: 4 }}>{candidate.razorpayOrderId ? "Razorpay order exists" : "No order yet"}</div></div></label>; })}</div>}</section>

      {results.length > 0 ? <section style={{ marginTop: 14, background: "white", border: "1px solid #dddcd7", padding: 20 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 16 }}><div><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 800 }}>TEST MODE EXECUTION</div><h2 style={{ margin: "7px 0 0", fontSize: 25 }}>{successfulOrders.length} real Razorpay order{successfulOrders.length === 1 ? "" : "s"} · {campaignLabels[campaignId] ?? campaignId}</h2></div><div style={{ textAlign: "right", color: "#666", fontSize: 11 }}>{confirmedCount} confirmed · {pendingPaymentCount} awaiting payment/reconciliation</div></div><div style={{ marginTop: 14, display: "grid", gap: 10 }}>{results.map((result) => <div key={result.transactionId} style={{ border: "1px solid #e4e4e0", padding: 14, display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, alignItems: "center", fontSize: 11 }}><div><div style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{result.transactionId}</div><div style={{ color: "#777", marginTop: 4 }}>{statuses[result.transactionId] ?? (result.ok ? "ORDER_CREATED" : result.error ?? "FAILED")} · {result.campaignId ?? campaignId}</div></div>{result.ok && result.order ? <strong>{money(result.order.amount)}</strong> : <span />}{result.ok && result.checkout ? <button disabled={activeTransaction !== "" || statuses[result.transactionId] === "ORDER_CONFIRMED"} onClick={() => openRazorpay(result)} style={{ border: 0, background: "#1e5b3e", color: "white", padding: "9px 12px", fontWeight: 800, cursor: "pointer" }}>{statuses[result.transactionId] === "ORDER_CONFIRMED" ? "Confirmed" : activeTransaction === result.transactionId ? "Opening…" : "Pay in Test Mode →"}</button> : <strong style={{ color: "#8d332d" }}>{result.error ?? "FAILED"}</strong>}</div>)}</div><div style={{ marginTop: 13, color: "#777", fontSize: 11 }}>Complete the Test Mode payments here. `/growth` independently re-reads captured Razorpay order/payment and campaign attribution before counting realized uplift.</div></section> : null}

      <section style={{ marginTop: 14, background: "#171717", color: "white", padding: 20 }}><div style={{ fontSize: 10, letterSpacing: ".1em", color: "#aaa", fontWeight: 800 }}>COHORT EVIDENCE</div><div style={{ marginTop: 9, color: "#c8c8c4", lineHeight: 1.6, fontSize: 12 }}>MANDATE authorization → MCP order creation → campaign attribution → Razorpay Test Mode Checkout → gateway signature verification → webhook/API reconciliation → merchant order → independent Razorpay settlement proof.</div></section>
    </div></main>
  </>;
}
