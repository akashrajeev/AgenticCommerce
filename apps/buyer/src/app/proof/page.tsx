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
type Proof = { status: string; transaction: Transaction | null; events: Event[]; stages: Stage[]; merchantOrder: MerchantOrder | null; summary: { baseAmountPaise: number; finalAmountPaise: number; incrementalRevenuePaise: number; persistedRevenuePaise: number; orderCount: number } | null; message?: string };

const money = (paise?: number) => typeof paise === "number" ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100) : "—";
const time = (value: string) => new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function UnifiedProofPage() {
  const [proof, setProof] = useState<Proof | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/proof", { cache: "no-store" });
      const body = await response.json() as Proof & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to load proof.");
      setProof(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load proof.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);

  const tx = proof?.transaction ?? null;
  const summary = proof?.summary;
  const upliftPercent = summary && summary.baseAmountPaise > 0 ? ((summary.incrementalRevenuePaise / summary.baseAmountPaise) * 100).toFixed(1) : "0.0";

  return <main style={{ minHeight: "100vh", background: "#f7f7f3", color: "#171717", fontFamily: "Arial, sans-serif", padding: "34px 20px 72px" }}><div style={{ maxWidth: 1120, margin: "0 auto" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, marginBottom: 28 }}><Link href="/labs" style={{ color: "#666", textDecoration: "none", fontSize: 13 }}>← Judge labs</Link><button onClick={() => void refresh()} disabled={loading} style={{ background: "white", border: "1px solid #cfcfc9", padding: "9px 12px", fontWeight: 700 }}>{loading ? "Refreshing…" : "Refresh live proof"}</button></div>
    <div style={{ borderTop: "2px solid #171717", paddingTop: 18 }}><div style={{ fontSize: 11, letterSpacing: ".12em", fontWeight: 700, color: "#777" }}>MANDATE / UNIFIED TRANSACTION PROOF</div><h1 style={{ fontSize: 52, lineHeight: 1.02, letterSpacing: "-.05em", margin: "10px 0 14px", maxWidth: 900 }}>One transaction. One auditable chain.</h1><p style={{ maxWidth: 780, color: "#666", lineHeight: 1.7, margin: 0 }}>This screen joins buyer intent, deterministic policy, Razorpay references, webhook evidence and realized merchant revenue for the latest meaningful transaction.</p></div>

    {error ? <div style={{ marginTop: 20, padding: 16, background: "#f6e9e7", border: "1px solid #dfc1bc", color: "#7b302b" }}>{error}</div> : null}
    {!tx && !loading ? <div style={{ marginTop: 24, padding: 22, background: "white", border: "1px solid #dddcd7" }}>{proof?.message ?? "No transaction yet. Run the buyer checkout first."}</div> : null}

    {tx ? <>
      <section style={{ marginTop: 30, background: "#171717", color: "white", padding: 22 }}><div style={{ fontSize: 10, color: "#bcbcb8", letterSpacing: ".1em", fontWeight: 700 }}>LIVE TRANSACTION</div><div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "end", marginTop: 10 }}><div><div style={{ fontFamily: "monospace", fontSize: 14 }}>{tx.id}</div><div style={{ marginTop: 8, fontSize: 28, fontWeight: 700, letterSpacing: "-.03em" }}>{money(tx.quote.totalPaise)}</div></div><div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: "#aaa" }}>STATE</div><strong style={{ display: "block", marginTop: 6, textTransform: "uppercase", letterSpacing: ".05em" }}>{tx.state.replaceAll("_", " ")}</strong></div></div></section>

      <section style={{ marginTop: 14, background: "white", border: "1px solid #dddcd7", padding: 22 }}><div style={{ fontSize: 11, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>AUTHORITY CHAIN</div><div style={{ display: "grid", gridTemplateColumns: `repeat(${proof?.stages.length ?? 1}, minmax(0, 1fr))`, gap: 8, marginTop: 18 }}>{(proof?.stages ?? []).map((stage, index) => <div key={stage.key} style={{ textAlign: "center" }}><div style={{ height: 7, background: stage.done ? "#2f6b4f" : "#deded9", marginBottom: 10 }} /><div style={{ fontSize: 11, fontWeight: 700 }}>{String(index + 1).padStart(2, "0")}</div><div style={{ fontSize: 11, color: stage.done ? "#1e5b3e" : "#999", marginTop: 4, fontWeight: 700 }}>{stage.label}</div></div>)}</div><div style={{ marginTop: 18, fontSize: 13, color: "#555" }}>AI proposes the intent. The gateway owns authorization. Razorpay owns payment execution. The merchant order appears only after verified payment.</div></section>

      <section style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={{ background: "white", border: "1px solid #dddcd7", padding: 22 }}><div style={{ fontSize: 11, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>BASKET & REVENUE</div><div style={{ marginTop: 12 }}>{tx.quote.lineItems.map((line) => <div key={line.productId} style={{ display: "flex", justifyContent: "space-between", padding: "11px 0", borderBottom: "1px solid #eee" }}><span><strong>{line.productId}</strong><small style={{ display: "block", color: "#777", marginTop: 3 }}>quantity {line.quantity}</small></span><strong>{money(line.lineTotalPaise)}</strong></div>)}</div><div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 14 }}><div style={{ padding: 12, background: "#fafaf7" }}><small style={{ color: "#777" }}>Base</small><strong style={{ display: "block", marginTop: 5 }}>{money(summary?.baseAmountPaise)}</strong></div><div style={{ padding: 12, background: "#fafaf7" }}><small style={{ color: "#777" }}>Final</small><strong style={{ display: "block", marginTop: 5 }}>{money(summary?.finalAmountPaise)}</strong></div><div style={{ padding: 12, background: "#eff6f1" }}><small style={{ color: "#1e5b3e" }}>Uplift</small><strong style={{ display: "block", marginTop: 5, color: "#1e5b3e" }}>+{money(summary?.incrementalRevenuePaise)} · {upliftPercent}%</strong></div></div></div>
        <div style={{ background: "white", border: "1px solid #dddcd7", padding: 22 }}><div style={{ fontSize: 11, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>PAYMENT REFERENCES</div>{[["Razorpay order", tx.razorpayOrderId], ["Razorpay payment", tx.razorpayPaymentId], ["Merchant order", proof?.merchantOrder?.merchantOrderId]].map(([label, value]) => <div key={label} style={{ padding: "13px 0", borderBottom: "1px solid #eee" }}><small style={{ color: "#777", display: "block" }}>{label}</small><strong style={{ display: "block", marginTop: 5, fontFamily: "monospace", fontSize: 12, overflowWrap: "anywhere" }}>{value ?? "Not created yet"}</strong></div>)}<div style={{ marginTop: 14, padding: 12, background: "#fafaf7" }}><small style={{ color: "#777" }}>Persisted realized revenue</small><strong style={{ display: "block", marginTop: 5 }}>{money(summary?.persistedRevenuePaise)}</strong></div></div>
      </section>

      <section style={{ marginTop: 14, background: "white", border: "1px solid #dddcd7", padding: 22 }}><div style={{ fontSize: 11, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>AUDIT TRAIL</div><div style={{ marginTop: 8 }}>{(proof?.events ?? []).slice().reverse().map((event) => <div key={event.id} style={{ display: "grid", gridTemplateColumns: "76px 150px 1fr", gap: 12, padding: "12px 0", borderBottom: "1px solid #eee", fontSize: 12 }}><span style={{ color: "#777", fontFamily: "monospace" }}>{time(event.createdAt)}</span><strong>{event.action.replaceAll("_", " ")}</strong><span style={{ color: "#666" }}>{event.reason}</span></div>)}</div></section>
    </> : null}

    <div style={{ marginTop: 26, color: "#777", fontSize: 11, lineHeight: 1.7 }}>The screen reads from the gateway's transaction/timeline APIs and persisted merchant-order attribution. It does not synthesize payment IDs or mark a transaction successful from the browser alone.</div>
  </div></main>;
}
