"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Transaction = { id: string; state: string; razorpayOrderId?: string; razorpayPaymentId?: string; quote?: { totalPaise?: number } };
type ReplayResult = {
  transactionId: string;
  dedupeKey: string;
  firstDelivery: "ACCEPTED" | "DUPLICATE";
  secondDelivery: "ACCEPTED" | "DUPLICATE";
  databaseBacked: boolean;
  stateBefore: string;
  stateAfter: string;
  mode?: "signed-webhook" | "internal-dedupe";
  signatureVerified?: boolean;
  matchedTransaction?: boolean;
};
const money = (paise?: number) => typeof paise === "number" ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100) : "—";

export default function WebhookReplayLab() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { void (async () => { try { const response = await fetch("/api/webhook-lab", { cache: "no-store" }); const body = await response.json() as { transactions?: Transaction[]; error?: string }; if (!response.ok) throw new Error(body.error ?? "Unable to load transactions."); setTransactions(body.transactions ?? []); if (body.transactions?.[0]) setSelectedId(body.transactions[0].id); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load transactions."); } })(); }, []);

  async function replay() {
    if (!selectedId) return;
    setLoading(true); setError(""); setResult(null);
    try { const response = await fetch("/api/webhook-lab", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactionId: selectedId, mode: "signed-webhook" }) }); const body = await response.json() as ReplayResult & { error?: string }; if (!response.ok) throw new Error(body.error ?? "Replay lab failed."); setResult(body); } catch (caught) { setError(caught instanceof Error ? caught.message : "Replay lab failed."); } finally { setLoading(false); }
  }

  const signed = result?.mode === "signed-webhook";

  return <main style={{ minHeight: "100vh", background: "#f7f7f3", color: "#171717", fontFamily: "Arial, sans-serif", padding: "34px 20px 70px" }}><div style={{ maxWidth: 1040, margin: "0 auto" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}><Link href="/" style={{ color: "#666", textDecoration: "none", fontSize: 13 }}>← Buyer workspace</Link><span style={{ border: "1px solid #c8d8ce", background: "#eff6f1", color: "#1e5b3e", padding: "7px 10px", fontSize: 11, fontWeight: 700 }}>JUDGE DEMO · WEBHOOK SAFETY</span></div>
    <div style={{ borderTop: "2px solid #171717", paddingTop: 18 }}><div style={{ fontSize: 11, letterSpacing: ".12em", fontWeight: 700, color: "#777" }}>MANDATE / WEBHOOK REPLAY LAB</div><h1 style={{ fontSize: 50, letterSpacing: "-.05em", lineHeight: 1.02, margin: "10px 0 14px", maxWidth: 760 }}>A signed event may arrive twice. The payment effect must happen once.</h1><p style={{ maxWidth: 760, color: "#666", lineHeight: 1.7, margin: 0 }}>When the gateway has a webhook secret configured, this lab creates a synthetic Razorpay <code>payment.captured</code> event, signs it with HMAC-SHA256, and sends the exact same event identity twice through the production webhook handler.</p></div>
    <section style={{ marginTop: 30, background: "white", border: "1px solid #dddcd7", padding: 22 }}><div style={{ fontSize: 11, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>CHOOSE AN EXISTING TRANSACTION</div><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} style={{ width: "100%", marginTop: 12, padding: 13, border: "1px solid #ccc", background: "white" }}><option value="">Select transaction</option>{transactions.map((transaction) => <option key={transaction.id} value={transaction.id}>{transaction.id} · {transaction.state.replaceAll("_", " ")} · {money(transaction.quote?.totalPaise)}</option>)}</select><div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}><div style={{ padding: 14, background: "#fafaf7", border: "1px solid #e8e7e2" }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".08em" }}>PAYMENT</div><strong style={{ display: "block", marginTop: 7, fontFamily: "monospace", fontSize: 12 }}>{transactions.find((item) => item.id === selectedId)?.razorpayPaymentId ?? "Not available"}</strong></div><div style={{ padding: 14, background: "#fafaf7", border: "1px solid #e8e7e2" }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".08em" }}>ORDER</div><strong style={{ display: "block", marginTop: 7, fontFamily: "monospace", fontSize: 12 }}>{transactions.find((item) => item.id === selectedId)?.razorpayOrderId ?? "Not available"}</strong></div></div><button disabled={!selectedId || loading} onClick={() => void replay()} style={{ marginTop: 18, border: 0, background: "#171717", color: "white", padding: "13px 16px", fontWeight: 700, cursor: "pointer" }}>{loading ? "Signing + delivering twice…" : "Send signed webhook twice →"}</button></section>
    {error ? <div style={{ marginTop: 16, padding: 16, background: "#f6e9e7", border: "1px solid #dfc1bc", color: "#7b302b", fontSize: 13 }}>{error}</div> : null}
    {result ? <section style={{ marginTop: 16, background: "white", border: "1px solid #dddcd7" }}><div style={{ padding: 20, borderBottom: "1px solid #e8e7e2" }}><div style={{ fontSize: 11, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>{signed ? "SIGNED WEBHOOK RESULT" : "REPLAY RESULT"}</div><h2 style={{ margin: "8px 0 6px", fontSize: 28 }}>{result.secondDelivery === "DUPLICATE" ? "Duplicate delivery blocked safely." : "Webhook delivered twice."}</h2><div style={{ fontFamily: "monospace", color: "#777", fontSize: 11 }}>{result.dedupeKey}</div></div><div style={{ padding: 20, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>{[["FIRST DELIVERY", result.firstDelivery], ["SECOND DELIVERY", result.secondDelivery], ["STATE BEFORE", result.stateBefore.replaceAll("_", " ")], ["STATE AFTER", result.stateAfter.replaceAll("_", " ")]].map(([label, value]) => <div key={label} style={{ border: "1px solid #e5e5e1", padding: 14 }}><div style={{ fontSize: 9, color: "#777", letterSpacing: ".08em", fontWeight: 700 }}>{label}</div><strong style={{ display: "block", marginTop: 8, fontSize: 13, color: value === "DUPLICATE" ? "#8d332d" : "#1e5b3e" }}>{value}</strong></div>)}</div><div style={{ padding: 20, borderTop: "1px solid #e8e7e2", background: "#fafaf7", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}><div><strong>{signed ? "Real webhook handler" : "Internal dedupe fallback"}</strong><p style={{ color: "#666", lineHeight: 1.6, fontSize: 12, margin: "7px 0 0" }}>{signed ? "The synthetic payload passed Razorpay HMAC verification before persistent idempotency was checked." : "No webhook secret or suitable Razorpay transaction was available, so the lab used the internal persistent idempotency boundary."}</p></div><div><strong>{result.databaseBacked ? "PostgreSQL-backed dedupe" : "In-memory demo dedupe"}</strong><p style={{ color: "#666", lineHeight: 1.6, fontSize: 12, margin: "7px 0 0" }}>{signed ? `Signature verified: ${result.signatureVerified ? "yes" : "no"} · matched transaction: ${result.matchedTransaction ? "yes" : "no"}` : "The duplicate webhook key is claimed once and does not create a second merchant order."}</p></div></div></section> : null}
    <div style={{ marginTop: 26, color: "#777", fontSize: 11, lineHeight: 1.7 }}>This remains a synthetic replay test; no live Razorpay payment is created. Production Razorpay webhook requests still verify their signature before reaching the persistent dedupe boundary.</div>
  </div></main>;
}
