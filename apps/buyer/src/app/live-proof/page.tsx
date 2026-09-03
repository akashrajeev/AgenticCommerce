"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Stage = { key: string; label: string; done: boolean };
type Event = { id: string; action: string; actor: string; createdAt: string; reason: string };
type Proof = {
  status: string;
  transaction: { id: string; state: string; quote: { totalPaise: number }; razorpayOrderId?: string; razorpayPaymentId?: string } | null;
  stages: Stage[];
  events: Event[];
  merchantOrder: { merchantOrderId: string } | null;
  summary: { baseAmountPaise: number; finalAmountPaise: number; incrementalRevenuePaise: number; persistedRevenuePaise: number; orderCount: number } | null;
  message?: string;
};

const money = (paise?: number) => typeof paise === "number" ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100) : "—";
const time = (value: string) => new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function LiveProofPage() {
  const [proof, setProof] = useState<Proof | null>(null);
  const [busy, setBusy] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function refresh(showBusy = false) {
    if (showBusy) setBusy(true);
    try {
      const response = await fetch("/api/proof", { cache: "no-store" });
      const body = await response.json() as Proof & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to load live proof.");
      setProof(body);
      setLastUpdated(new Date().toISOString());
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load live proof.");
    } finally {
      if (showBusy) setBusy(false);
    }
  }

  useEffect(() => {
    void refresh(true);
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, []);

  const webhookDone = useMemo(() => proof?.stages.some((stage) => stage.key === "webhook" && stage.done) ?? false, [proof]);
  const verifiedDone = useMemo(() => proof?.stages.some((stage) => stage.key === "verified" && stage.done) ?? false, [proof]);
  const upliftPercent = proof?.summary && proof.summary.baseAmountPaise > 0 ? ((proof.summary.incrementalRevenuePaise / proof.summary.baseAmountPaise) * 100).toFixed(1) : "0.0";

  return <main style={{ minHeight: "100vh", background: "#f7f7f3", color: "#171717", fontFamily: "Arial, sans-serif", padding: "34px 20px 72px" }}><div style={{ maxWidth: 1120, margin: "0 auto" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 18, marginBottom: 28 }}><Link href="/labs" style={{ color: "#666", textDecoration: "none", fontSize: 13 }}>← Judge labs</Link><div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "#666" }}><span style={{ width: 8, height: 8, borderRadius: 999, background: "#2f6b4f", display: "inline-block" }} /> Auto-refreshing every 3s <button onClick={() => void refresh(true)} disabled={busy} style={{ background: "white", border: "1px solid #cfcfc9", padding: "8px 11px", fontWeight: 700 }}>{busy ? "Refreshing…" : "Refresh now"}</button></div></div>
    <div style={{ borderTop: "2px solid #171717", paddingTop: 18 }}><div style={{ fontSize: 11, color: "#777", letterSpacing: ".12em", fontWeight: 700 }}>MANDATE / LIVE PROOF</div><h1 style={{ fontSize: 52, lineHeight: 1.02, letterSpacing: "-.05em", margin: "10px 0 14px", maxWidth: 900 }}>Watch the payment chain settle in real time.</h1><p style={{ maxWidth: 780, color: "#666", lineHeight: 1.7, margin: 0 }}>Designed for the moment after checkout: webhook delivery, reconciliation and durable revenue attribution can appear without a manual page reload.</p></div>
    {error ? <div style={{ marginTop: 20, padding: 15, background: "#f6e9e7", border: "1px solid #dfc1bc", color: "#7b302b" }}>{error}</div> : null}
    {!proof?.transaction && !busy ? <div style={{ marginTop: 22, padding: 22, background: "white", border: "1px solid #dddcd7" }}>{proof?.message ?? "Run the golden path to create the first transaction."}</div> : null}
    {proof?.transaction ? <>
      <section style={{ marginTop: 28, background: "#171717", color: "white", padding: 22 }}><div style={{ fontSize: 10, color: "#bcbcb8", letterSpacing: ".1em", fontWeight: 700 }}>TRANSACTION</div><div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 20, marginTop: 10 }}><div><div style={{ fontFamily: "monospace", fontSize: 13 }}>{proof.transaction.id}</div><div style={{ fontSize: 29, fontWeight: 700, marginTop: 8 }}>{money(proof.transaction.quote.totalPaise)}</div></div><div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: "#aaa", letterSpacing: ".08em" }}>STATE</div><strong style={{ display: "block", marginTop: 6, textTransform: "uppercase" }}>{proof.transaction.state.replaceAll("_", " ")}</strong></div></div></section>
      <section style={{ marginTop: 14, background: "white", border: "1px solid #dddcd7", padding: 22 }}><div style={{ fontSize: 11, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>LIVE AUTHORITY CHAIN</div><div style={{ display: "grid", gridTemplateColumns: `repeat(${proof.stages.length || 1}, minmax(0, 1fr))`, gap: 8, marginTop: 17 }}>{proof.stages.map((stage, index) => <div key={stage.key} style={{ textAlign: "center" }}><div style={{ height: 8, background: stage.done ? "#2f6b4f" : "#deded9", marginBottom: 9 }} /><div style={{ fontSize: 10, color: "#777" }}>{String(index + 1).padStart(2, "0")}</div><div style={{ marginTop: 4, fontSize: 11, fontWeight: 700, color: stage.done ? "#1e5b3e" : "#999" }}>{stage.label}</div></div>)}</div><div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11 }}><span style={{ border: "1px solid #d9d9d3", padding: "7px 9px" }}>{webhookDone ? "✓ Webhook observed" : "○ Waiting for webhook"}</span><span style={{ border: "1px solid #d9d9d3", padding: "7px 9px" }}>{verifiedDone ? "✓ Payment verified" : "○ Verification pending"}</span><span style={{ border: "1px solid #d9d9d3", padding: "7px 9px" }}>{proof.merchantOrder ? "✓ Merchant order persisted" : "○ Merchant order pending"}</span></div></section>
      <section style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}><div style={{ background: "white", border: "1px solid #dddcd7", padding: 22 }}><div style={{ fontSize: 11, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>REVENUE PROOF</div><div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}><div style={{ background: "#fafaf7", padding: 13 }}><small style={{ color: "#777" }}>Base</small><strong style={{ display: "block", marginTop: 6 }}>{money(proof.summary?.baseAmountPaise)}</strong></div><div style={{ background: "#fafaf7", padding: 13 }}><small style={{ color: "#777" }}>Final</small><strong style={{ display: "block", marginTop: 6 }}>{money(proof.summary?.finalAmountPaise)}</strong></div><div style={{ background: "#eff6f1", padding: 13 }}><small style={{ color: "#1e5b3e" }}>Realized uplift</small><strong style={{ display: "block", marginTop: 6, color: "#1e5b3e" }}>+{money(proof.summary?.incrementalRevenuePaise)}</strong></div></div><div style={{ marginTop: 14, fontSize: 12, color: "#555" }}>Confirmed orders: <strong>{proof.summary?.orderCount ?? 0}</strong> · uplift: <strong>{upliftPercent}%</strong> · persisted uplift: <strong>{money(proof.summary?.persistedRevenuePaise)}</strong></div></div><div style={{ background: "white", border: "1px solid #dddcd7", padding: 22 }}><div style={{ fontSize: 11, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>EXTERNAL EVIDENCE</div><div style={{ marginTop: 13, display: "grid", gap: 11 }}>{[["Razorpay order", proof.transaction.razorpayOrderId], ["Razorpay payment", proof.transaction.razorpayPaymentId], ["Merchant order", proof.merchantOrder?.merchantOrderId]].map(([label, value]) => <div key={label}><small style={{ color: "#777", display: "block" }}>{label}</small><strong style={{ display: "block", marginTop: 4, fontFamily: "monospace", fontSize: 12, overflowWrap: "anywhere" }}>{value ?? "Not available"}</strong></div>)}</div></div></section>
      <section style={{ marginTop: 14, background: "white", border: "1px solid #dddcd7", padding: 22 }}><div style={{ fontSize: 11, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>LATEST AUDIT EVENTS</div><div style={{ marginTop: 8 }}>{proof.events.slice(-8).reverse().map((event) => <div key={event.id} style={{ display: "grid", gridTemplateColumns: "78px 170px 1fr", gap: 12, padding: "10px 0", borderBottom: "1px solid #eee", fontSize: 12 }}><span style={{ fontFamily: "monospace", color: "#777" }}>{time(event.createdAt)}</span><strong>{event.action.replaceAll("_", " ")}</strong><span style={{ color: "#666" }}>{event.reason}</span></div>)}</div></section>
    </> : null}
    <div style={{ marginTop: 24, color: "#888", fontSize: 11 }}>Last refresh: {lastUpdated ? time(lastUpdated) : "—"}. Webhook status is derived from the gateway audit trail, not from browser assumptions.</div>
  </div></main>;
}
