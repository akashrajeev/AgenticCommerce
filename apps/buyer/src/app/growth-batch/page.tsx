"use client";

import { useEffect, useState } from "react";

type Candidate = { transactionId: string; authorizationId: string; amountPaise: number | null; currency: string; state: string; merchantId: string | null; productId: string | null; razorpayOrderId: string | null };
type BatchResult = { transactionId: string; ok: boolean; body?: unknown; error?: string };

const money = (paise: number | null) => typeof paise === "number" ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100) : "—";

export default function GrowthBatchPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<BatchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/growth-batch", { cache: "no-store" });
      const body = await response.json() as { candidates?: Candidate[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to load batch candidates.");
      setCandidates(body.candidates ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load batch candidates.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function createOrders() {
    setRunning(true); setError("");
    try {
      const response = await fetch("/api/growth-batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactionIds: selected }), cache: "no-store" });
      const body = await response.json() as { results?: BatchResult[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Batch request failed.");
      setResults(body.results ?? []);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Batch request failed.");
    } finally { setRunning(false); }
  }

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 5 ? [...current, id] : current);
  }

  return <main style={{ minHeight: "100vh", background: "#f5f5f2", color: "#171717", fontFamily: "Arial, sans-serif", padding: 36 }}><div style={{ maxWidth: 1080, margin: "0 auto" }}>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 24 }}><div><div style={{ fontSize: 11, color: "#1e5b3e", letterSpacing: ".12em", fontWeight: 800 }}>TEST MODE · GROWTH BATCH</div><h1 style={{ fontSize: 50, lineHeight: 1, letterSpacing: "-.05em", margin: "10px 0" }}>Create a real payment cohort.</h1><p style={{ maxWidth: 760, color: "#666", lineHeight: 1.7, margin: 0 }}>Select existing MANDATE-authorized transactions and create up to five real Razorpay Test Mode orders through the MCP policy boundary. No amount, payment ID, or authorization is invented by this page.</p></div><a href="/growth" style={{ color: "#171717", fontWeight: 700, textDecoration: "none" }}>← Growth dashboard</a></header>

    <section style={{ marginTop: 24, display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", background: "#171717", color: "white", padding: 18 }}><div><strong>{selected.length}/5 selected</strong><div style={{ color: "#bbb", fontSize: 11, marginTop: 4 }}>Only policy-authorized transactions are selectable.</div></div><button disabled={running || selected.length === 0} onClick={() => void createOrders()} style={{ border: 0, background: "white", color: "#171717", padding: "11px 14px", fontWeight: 800, cursor: selected.length ? "pointer" : "not-allowed" }}>{running ? "Creating…" : "Create Test Mode orders →"}</button></section>

    {error ? <div style={{ marginTop: 14, padding: 14, border: "1px solid #dfc1bc", background: "#f6e9e7", color: "#7b302b", fontSize: 12 }}>{error}</div> : null}

    <section style={{ marginTop: 14, background: "white", border: "1px solid #dddcd7" }}><div style={{ padding: 18, borderBottom: "1px solid #e8e7e2" }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 800 }}>REAL CANDIDATES</div><h2 style={{ margin: "7px 0 0", fontSize: 25 }}>Policy-authorized transactions</h2></div>{loading ? <div style={{ padding: 22, color: "#777" }}>Loading live gateway state…</div> : candidates.length === 0 ? <div style={{ padding: 22, color: "#777" }}>No authorized transactions yet. Run the flagship negotiation flow first.</div> : <div>{candidates.map((candidate) => { const checked = selected.includes(candidate.transactionId); return <label key={candidate.transactionId} style={{ display: "grid", gridTemplateColumns: "32px 1fr auto", gap: 14, alignItems: "center", padding: 16, borderBottom: "1px solid #eee", background: checked ? "#f0f6f2" : "white", cursor: "pointer" }}><input type="checkbox" checked={checked} onChange={() => toggle(candidate.transactionId)} /><div><div style={{ fontWeight: 800 }}>{candidate.productId ?? "Transaction"}</div><div style={{ color: "#777", fontSize: 10, marginTop: 4, fontFamily: "monospace", wordBreak: "break-all" }}>{candidate.transactionId}</div><div style={{ color: "#777", fontSize: 10, marginTop: 4 }}>{candidate.merchantId ?? "merchant"} · {candidate.state} · MANDATE {candidate.authorizationId}</div></div><div style={{ textAlign: "right" }}><strong>{money(candidate.amountPaise)}</strong><div style={{ color: candidate.razorpayOrderId ? "#1e5b3e" : "#777", fontSize: 10, marginTop: 4 }}>{candidate.razorpayOrderId ? "Razorpay order exists" : "No order yet"}</div></div></label>; })}</div>}</section>

    {results.length > 0 ? <section style={{ marginTop: 14, background: "white", border: "1px solid #dddcd7", padding: 20 }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 800 }}>BATCH RESULT</div><div style={{ marginTop: 12, display: "grid", gap: 9 }}>{results.map((result) => <div key={result.transactionId} style={{ border: "1px solid #e4e4e0", padding: 13, display: "flex", justifyContent: "space-between", gap: 14, fontSize: 11 }}><span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{result.transactionId}</span><strong style={{ color: result.ok ? "#1e5b3e" : "#8d332d" }}>{result.ok ? "TEST ORDER CREATED" : result.error ?? "FAILED"}</strong></div>)}</div><div style={{ marginTop: 13, color: "#777", fontSize: 11 }}>After completing Test Mode payments, return to <a href="/growth">/growth</a>; only Razorpay-reverified captured payments contribute to batch uplift.</div></section> : null}
  </div></main>;
}
