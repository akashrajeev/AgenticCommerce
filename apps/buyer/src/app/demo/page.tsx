"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Check = { key: string; label: string; ok: boolean; detail: string };
type DemoStatus = { ready: boolean; checks: Check[]; generatedAt: string; stats: { transactions: number; merchantOrders: number; realizedIncrementalRevenuePaise: number }; error?: string };
const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);

export default function DemoReadiness() {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/demo", { cache: "no-store" });
      const body = await response.json() as DemoStatus;
      if (!response.ok) throw new Error(body.error ?? "Unable to load demo status.");
      setStatus(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load demo status.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);
  const ready = status?.ready ?? false;

  return <main style={{ minHeight: "100vh", background: "#f7f7f3", color: "#171717", fontFamily: "Arial, sans-serif", padding: "34px 20px 72px" }}><div style={{ maxWidth: 1080, margin: "0 auto" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "center", marginBottom: 28 }}><Link href="/labs" style={{ color: "#666", textDecoration: "none", fontSize: 13 }}>← Judge labs</Link><button onClick={() => void refresh()} disabled={loading} style={{ border: "1px solid #cfcfc9", background: "white", padding: "9px 12px", fontWeight: 700 }}>{loading ? "Checking…" : "Run readiness check"}</button></div>
    <div style={{ borderTop: "2px solid #171717", paddingTop: 18 }}><div style={{ fontSize: 11, letterSpacing: ".12em", color: "#777", fontWeight: 700 }}>MANDATE / DEMO READINESS</div><h1 style={{ fontSize: 54, lineHeight: 1, letterSpacing: "-.05em", margin: "10px 0 14px", maxWidth: 800 }}>Know the demo is ready before the judge arrives.</h1><p style={{ maxWidth: 760, color: "#666", lineHeight: 1.7, margin: 0 }}>This private server-side check verifies the buyer's merchant connection, gateway, Razorpay test rail and persisted transaction/revenue stores without exposing credentials.</p></div>
    {error ? <div style={{ marginTop: 20, padding: 16, background: "#f6e9e7", border: "1px solid #dfc1bc", color: "#7b302b" }}>{error}</div> : null}
    <section style={{ marginTop: 30, display: "grid", gridTemplateColumns: "1.1fr .9fr", gap: 14 }}>
      <div style={{ background: ready ? "#eff6f1" : "white", border: `1px solid ${ready ? "#b8cdbf" : "#dddcd7"}`, padding: 24 }}><div style={{ fontSize: 11, letterSpacing: ".1em", color: ready ? "#1e5b3e" : "#777", fontWeight: 700 }}>SYSTEM VERDICT</div><div style={{ marginTop: 10, fontSize: 36, letterSpacing: "-.04em", fontWeight: 700 }}>{loading ? "Checking…" : ready ? "READY FOR DEMO" : "NOT READY"}</div><div style={{ marginTop: 10, color: "#666", lineHeight: 1.6, fontSize: 13 }}>{ready ? "All required service checks are responding." : "Resolve the failed checks before relying on a live demo."}</div></div>
      <div style={{ background: "#171717", color: "white", padding: 24 }}><div style={{ fontSize: 11, color: "#bcbcb8", letterSpacing: ".1em", fontWeight: 700 }}>LIVE DATA</div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 14 }}><div><div style={{ fontSize: 10, color: "#aaa" }}>Transactions</div><strong style={{ display: "block", marginTop: 5, fontSize: 24 }}>{status?.stats.transactions ?? 0}</strong></div><div><div style={{ fontSize: 10, color: "#aaa" }}>Merchant orders</div><strong style={{ display: "block", marginTop: 5, fontSize: 24 }}>{status?.stats.merchantOrders ?? 0}</strong></div><div style={{ gridColumn: "1 / -1" }}><div style={{ fontSize: 10, color: "#aaa" }}>Realized incremental revenue</div><strong style={{ display: "block", marginTop: 5, fontSize: 24 }}>{money(status?.stats.realizedIncrementalRevenuePaise ?? 0)}</strong></div></div></div>
    </section>
    <section style={{ marginTop: 14, background: "white", border: "1px solid #dddcd7", padding: 22 }}>{(status?.checks ?? []).map((check) => <div key={check.key} style={{ display: "grid", gridTemplateColumns: "34px 1fr auto", gap: 12, alignItems: "center", padding: "14px 0", borderBottom: "1px solid #eee" }}><span style={{ fontWeight: 700, fontSize: 18, color: check.ok ? "#1e5b3e" : "#9b3a32" }}>{check.ok ? "✓" : "×"}</span><div><strong>{check.label}</strong><div style={{ color: "#777", fontSize: 12, marginTop: 4 }}>{check.detail}</div></div><span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", color: check.ok ? "#1e5b3e" : "#9b3a32" }}>{check.ok ? "PASS" : "CHECK"}</span></div>)}</section>
    <section style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}><Link href="/proof" style={{ background: "#171717", color: "white", textDecoration: "none", padding: "12px 15px", fontWeight: 700 }}>Open unified proof →</Link><Link href="/policy-lab" style={{ background: "white", color: "#171717", textDecoration: "none", padding: "12px 15px", border: "1px solid #cfcfc9", fontWeight: 700 }}>Policy lab</Link><Link href="/webhook-lab" style={{ background: "white", color: "#171717", textDecoration: "none", padding: "12px 15px", border: "1px solid #cfcfc9", fontWeight: 700 }}>Webhook lab</Link></section>
    <div style={{ marginTop: 22, color: "#777", fontSize: 11 }}>Last checked: {status?.generatedAt ? new Date(status.generatedAt).toLocaleString("en-IN") : "—"}</div>
  </div></main>;
}
