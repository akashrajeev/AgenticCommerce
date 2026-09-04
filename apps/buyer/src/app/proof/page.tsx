"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Stage = { key: string; label: string; done: boolean };
type Event = { id: string; action: string; actor: string; createdAt: string; reason: string };
type Transaction = {
  id: string;
  state: string;
  intent: { merchantId: string; productId: string; quantity: number; maxSpendPaise: number; lineItems?: Array<{ productId: string; quantity: number }> };
  quote: { totalPaise: number; currency: string; lineItems: Array<{ productId: string; quantity: number; unitPricePaise: number; lineTotalPaise: number }> };
  policy?: { decision: "ALLOW" | "BLOCK"; checks: Array<{ rule: string; result: "PASS" | "FAIL"; observed: string }> };
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
};
type MerchantOrder = { merchantOrderId: string; amountPaise: number; baseAmountPaise: number; incrementalRevenuePaise: number; lineItems?: Array<{ productId: string; quantity: number; unitPricePaise: number; lineTotalPaise: number }>; createdAt: string };
type RazorpayEvidence = {
  verified: boolean;
  testMode: boolean;
  transactionId: string;
  orderId: string;
  paymentId: string;
  amountPaise: number;
  currency: string;
  order?: { id: string; status: string; amount: number; amountPaid: number; receipt: string };
  payment?: { id: string; status: string; amount: number; currency: string; orderId: string | null; method: string | null };
};
type Proof = { status: string; transaction: Transaction | null; events: Event[]; stages: Stage[]; merchantOrder: MerchantOrder | null; razorpayEvidence?: RazorpayEvidence | null; summary: { baseAmountPaise: number; finalAmountPaise: number; incrementalRevenuePaise: number; persistedRevenuePaise: number; orderCount: number } | null; message?: string };

const money = (paise?: number) => typeof paise === "number" ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100) : "—";
const time = (value: string) => new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function UnifiedProofPage() {
  const [proof, setProof] = useState<Proof | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [error, setError] = useState("");

  async function loadProof(showLoading: boolean) {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/proof", { cache: "no-store" });
      const body = await response.json() as Proof & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to load proof.");
      setProof(body);
    } catch (caught) {
      if (showLoading) setError(caught instanceof Error ? caught.message : "Unable to load proof.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    void loadProof(true);
    const timer = window.setInterval(() => void loadProof(false), 2500);
    setLive(true);
    return () => {
      window.clearInterval(timer);
      setLive(false);
    };
  }, []);

  const tx = proof?.transaction ?? null;
  const summary = proof?.summary;
  const upliftPercent = summary && summary.baseAmountPaise > 0 ? ((summary.incrementalRevenuePaise / summary.baseAmountPaise) * 100).toFixed(1) : "0.0";
  const razorpay = proof?.razorpayEvidence ?? null;
  const razorpayVerified = razorpay?.verified === true && razorpay?.testMode === true;

  return <main style={{ minHeight: "100vh", background: "#f7f7f3", color: "#171717", fontFamily: "Arial, sans-serif", padding: "34px 20px 72px" }}><div style={{ maxWidth: 1120, margin: "0 auto" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, marginBottom: 28 }}><Link href="/labs" style={{ color: "#666", textDecoration: "none", fontSize: 13 }}>← Judge labs</Link><div style={{ display: "flex", alignItems: "center", gap: 12 }}><span style={{ fontSize: 10, color: live ? "#1e5b3e" : "#777", letterSpacing: ".08em", fontWeight: 700 }}>{live ? "LIVE · AUTO-REFRESH 2.5s" : "LIVE"}</span><button onClick={() => void loadProof(true)} disabled={loading} style={{ background: "white", border: "1px solid #cfcfc9", padding: "9px 12px", fontWeight: 700 }}>{loading ? "Refreshing…" : "Refresh live proof"}</button></div></div>
    <div style={{ borderTop: "2px solid #171717", paddingTop: 18 }}><div style={{ fontSize: 11, letterSpacing: ".12em", fontWeight: 700, color: "#777" }}>MANDATE / UNIFIED TRANSACTION PROOF</div><h1 style={{ fontSize: 52, lineHeight: 1.02, letterSpacing: "-.05em", margin: "10px 0 14px", maxWidth: 900 }}>One transaction. One auditable chain.</h1><p style={{ maxWidth: 780, color: "#666", lineHeight: 1.7, margin: 0 }}>This screen joins buyer intent, deterministic policy, live Razorpay Test Mode evidence, webhook evidence and realized merchant revenue for the latest meaningful transaction.</p></div>

    {error ? <div style={{ marginTop: 20, padding: 16, background: "#f6e9e7", border: "1px solid #dfc1bc", color: "#7b302b" }}>{error}</div> : null}
    {!tx && !loading ? <div style={{ marginTop: 24, padding: 22, background: "white", border: "1px solid #dddcd7" }}>{proof?.message ?? "No transaction yet. Run the buyer checkout first."}</div> : null}

    {tx ? <>
      <section style={{ marginTop: 30, background: "#171717", color: "white", padding: 22 }}><div style={{ fontSize: 10, color: "#bcbcb8", letterSpacing: ".1em", fontWeight: 700 }}>LIVE TRANSACTION</div><div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "end", marginTop: 10 }}><div><div style={{ fontFamily: "monospace", fontSize: 14 }}>{tx.id}</div><div style={{ marginTop: 8, fontSize: 28, fontWeight: 700, letterSpacing: "-.03em" }}>{money(tx.quote.totalPaise)}</div></div><div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: "#aaa" }}>STATE</div><strong style={{ display: "block", marginTop: 6, textTransform: "uppercase", letterSpacing: ".05em" }}>{tx.state.replaceAll("_", " ")}</strong></div></div></section>

      <section style={{ marginTop: 14, background: "white", border: "1px solid #dddcd7", padding: 22 }}><div style={{ fontSize: 11, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>AUTHORITY CHAIN</div><div style={{ display: "grid", gridTemplateColumns: `repeat(${proof?.stages.length ?? 1}, minmax(0, 1fr))`, gap: 8, marginTop: 18 }}>{(proof?.stages ?? []).map((stage, index) => <div key={stage.key} style={{ textAlign: "center" }}><div style={{ height: 7, background: stage.done ? "#2f6b4f" : "#deded9", marginBottom: 10 }} /><div style={{ fontSize: 11, fontWeight: 700 }}>{String(index + 1).padStart(2, "0")}</div><div style={{ fontSize: 11, color: stage.done ? "#1e5b3e" : "#999", marginTop: 4, fontWeight: 700 }}>{stage.label}</div></div>)}</div><div style={{ marginTop: 18, fontSize: 13, color: "#555" }}>AI proposes the intent. The gateway owns authorization. Razorpay owns payment execution. The merchant order appears only after verified payment.</div></section>

      <section style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={{ background: "white", border: "1px solid #dddcd7", padding: 22 }}><div style={{ fontSize: 11, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>BASKET & REVENUE</div><div style={{ marginTop: 12 }}>{tx.quote.lineItems.map((line) => <div key={line.productId} style={{ display: "flex", justifyContent: "space-between", padding: "11px 0", borderBottom: "1px solid #eee" }}><span><strong>{line.productId}</strong><small style={{ display: "block", color: "#777", marginTop: 3 }}>quantity {line.quantity}</small></span><strong>{money(line.lineTotalPaise)}</strong></div>)}</div><div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 14 }}><div style={{ padding: 12, background: "#fafaf7" }}><small style={{ color: "#777" }}>Base</small><strong style={{ display: "block", marginTop: 5 }}>{money(summary?.baseAmountPaise)}</strong></div><div style={{ padding: 12, background: "#fafaf7" }}><small style={{ color: "#777" }}>Final</small><strong style={{ display: "block", marginTop: 5 }}>{money(summary?.finalAmountPaise)}</strong></div><div style={{ padding: 12, background: "#eff6f1" }}><small style={{ color: "#1e5b3e" }}>Uplift</small><strong style={{ display: "block", marginTop: 5, color: "#1e5b3e" }}>+{money(summary?.incrementalRevenuePaise)} · {upliftPercent}%</strong></div></div></div>
        <div style={{ background: "white", border: "1px solid #dddcd7", padding: 22 }}><div style={{ fontSize: 11, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>PAYMENT REFERENCES</div>{[["Razorpay order", tx.razorpayOrderId], ["Razorpay payment", tx.razorpayPaymentId], ["Merchant order", proof?.merchantOrder?.merchantOrderId]].map(([label, value]) => <div key={label} style={{ padding: "13px 0", borderBottom: "1px solid #eee" }}><small style={{ color: "#777", display: "block" }}>{label}</small><strong style={{ display: "block", marginTop: 5, fontFamily: "monospace", fontSize: 12, overflowWrap: "anywhere" }}>{value ?? "Not created yet"}</strong></div>)}<div style={{ marginTop: 14, padding: 12, background: "#fafaf7" }}><small style={{ color: "#777" }}>Persisted realized revenue</small><strong style={{ display: "block", marginTop: 5 }}>{money(summary?.persistedRevenuePaise)}</strong></div></div>
      </section>

      <section style={{ marginTop: 14, padding: 22, border: `1px solid ${razorpayVerified ? "#b9d3c2" : "#dddcd7"}`, background: razorpayVerified ? "#eff6f1" : "white" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 18 }}><div><div style={{ fontSize: 11, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>INDEPENDENT RAZORPAY ATTESTATION</div><h2 style={{ margin: "7px 0 4px", fontSize: 24 }}>{razorpayVerified ? "VERIFIED · RAZORPAY TEST MODE" : "Waiting for live Razorpay verification"}</h2><p style={{ color: "#666", lineHeight: 1.6, fontSize: 12, margin: 0 }}>{razorpayVerified ? "The gateway re-read the Razorpay order and payment, matched amount and bindings to this transaction, and confirmed a captured Test Mode payment." : "A local transaction state is not sufficient. This section turns green only after the gateway independently verifies the Razorpay Test Mode objects."}</p></div><span style={{ fontSize: 10, fontWeight: 900, padding: "8px 10px", border: `1px solid ${razorpayVerified ? "#7aa68a" : "#ccc"}`, color: razorpayVerified ? "#1e5b3e" : "#777" }}>{razorpayVerified ? "LIVE EVIDENCE" : "UNVERIFIED"}</span></div>{razorpay ? <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>{[["Order status", razorpay.order?.status ?? "—"], ["Payment status", razorpay.payment?.status ?? "—"], ["Amount", money(razorpay.amountPaise)], ["Method", razorpay.payment?.method ?? "—"]].map(([label, value]) => <div key={label} style={{ padding: 12, background: "white", border: "1px solid #e2e5df" }}><small style={{ color: "#777" }}>{label}</small><strong style={{ display: "block", marginTop: 4, fontSize: 13 }}>{value}</strong></div>)}</div> : null}</section>

      <section style={{ marginTop: 14, background: "white", border: "1px solid #dddcd7", padding: 22 }}><div style={{ fontSize: 11, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>AUDIT TRAIL</div><div style={{ marginTop: 8 }}>{(proof?.events ?? []).slice().reverse().map((event) => <div key={event.id} style={{ display: "grid", gridTemplateColumns: "76px 150px 1fr", gap: 12, padding: "12px 0", borderBottom: "1px solid #eee", fontSize: 12 }}><span style={{ color: "#777", fontFamily: "monospace" }}>{time(event.createdAt)}</span><strong>{event.action.replaceAll("_", " ")}</strong><span style={{ color: "#666" }}>{event.reason}</span></div>)}</div></section>
    </> : null}

    <div style={{ marginTop: 26, color: "#777", fontSize: 11, lineHeight: 1.7 }}>The screen reads from the gateway's transaction/timeline APIs, persisted merchant-order attribution, and an independent Razorpay Test Mode re-read through the authenticated payment tool. It does not synthesize payment IDs or mark a transaction successful from the browser alone.</div>
  </div></main>;
}
