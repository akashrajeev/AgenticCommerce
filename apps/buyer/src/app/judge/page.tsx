"use client";

import { useEffect, useState } from "react";

type Check = { key: string; label: string; ok: boolean; detail: string };
type JudgePayload = { generatedAt: string; testMode: boolean; checks: Check[]; metrics: { authorizedTransactions: number; confirmedTransactions: number; merchantOrders: number; razorpayVerifiedPayments: number; protocolCount: number }; links: Record<string, string> };

export default function JudgeModePage() {
  const [data, setData] = useState<JudgePayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function runSweep() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/judge", { cache: "no-store" });
      const body = await response.json() as JudgePayload & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Judge sweep failed.");
      setData(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Judge sweep failed.");
    } finally { setBusy(false); }
  }

  useEffect(() => { void runSweep(); }, []);

  const green = data?.checks.filter((check) => check.ok).length ?? 0;
  const total = data?.checks.length ?? 0;

  return <main style={{ minHeight: "100vh", background: "#f4f4f1", color: "#171717", padding: "36px 20px 72px", fontFamily: "Inter, Arial, sans-serif" }}><div style={{ maxWidth: 1160, margin: "0 auto" }}>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 24, marginBottom: 30 }}><div><div style={{ fontSize: 11, letterSpacing: 2, fontWeight: 800, color: "#1e5b3e" }}>RAZORPAY TRACK 01 · JUDGE MODE</div><h1 style={{ fontSize: 50, lineHeight: .98, letterSpacing: "-.05em", margin: "8px 0 12px" }}>One control plane. Real payment evidence.</h1><p style={{ maxWidth: 820, color: "#5f605b", lineHeight: 1.6, margin: 0 }}>A single live sweep checks the merchant, MANDATE, MCP, x402 readiness and Razorpay Test Mode evidence. Successful payment metrics only come from persisted orders independently re-read from Razorpay.</p></div><button disabled={busy} onClick={() => void runSweep()} style={{ border: 0, background: "#171717", color: "white", padding: "12px 14px", fontWeight: 800, cursor: "pointer" }}>{busy ? "Refreshing…" : "Run live sweep ↻"}</button></header>

    {error ? <div style={{ padding: 13, border: "1px solid #dfc1bc", background: "#f6e9e7", color: "#7b302b", marginBottom: 16, fontSize: 12 }}>{error}</div> : null}

    <section style={{ display: "grid", gridTemplateColumns: "1.1fr .9fr", gap: 16 }}>
      <div style={{ background: "#171717", color: "white", padding: 24 }}><div style={{ fontSize: 10, color: "#aaa", letterSpacing: 1.5, fontWeight: 800 }}>LIVE READINESS</div><div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "end", marginTop: 12 }}><div><div style={{ fontSize: 48, lineHeight: 1, fontWeight: 900 }}>{green}/{total}</div><div style={{ marginTop: 7, color: "#bdbdb8", fontSize: 12 }}>checks currently green</div></div><div style={{ padding: "9px 11px", border: `1px solid ${data?.testMode ? "#4f725f" : "#7a514b"}`, color: data?.testMode ? "#cfe2d6" : "#e3beb8", fontSize: 10, fontWeight: 800 }}>{data?.testMode ? "RAZORPAY TEST MODE CONFIRMED" : "TEST MODE NOT CONFIRMED"}</div></div><div style={{ marginTop: 22, display: "grid", gap: 9 }}>{data?.checks.map((check) => <div key={check.key} style={{ display: "grid", gridTemplateColumns: "10px 1fr auto", gap: 10, alignItems: "center", borderTop: "1px solid #30302f", paddingTop: 10 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: check.ok ? "#86b69b" : "#b86a61" }} /><div><strong style={{ fontSize: 12 }}>{check.label}</strong><div style={{ color: "#a9a9a5", marginTop: 3, fontSize: 10 }}>{check.detail}</div></div><span style={{ fontSize: 10, fontWeight: 900, color: check.ok ? "#b9d3c2" : "#d8aaa4" }}>{check.ok ? "PASS" : "BLOCKED"}</span></div>)}</div></div>

      <div style={{ background: "white", border: "1px solid #dddcd7", padding: 24 }}><div style={{ fontSize: 10, color: "#777", letterSpacing: 1.5, fontWeight: 800 }}>REAL EVIDENCE COUNTS</div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 15 }}>{[["Authorized TX", data?.metrics.authorizedTransactions ?? 0], ["Confirmed TX", data?.metrics.confirmedTransactions ?? 0], ["Merchant orders", data?.metrics.merchantOrders ?? 0], ["Razorpay verified", data?.metrics.razorpayVerifiedPayments ?? 0], ["Protocols", data?.metrics.protocolCount ?? 0], ["Mode", data?.testMode ? "TEST" : "—"]].map(([label, value]) => <div key={label} style={{ border: "1px solid #e3e3df", padding: 15 }}><div style={{ fontSize: 9, color: "#777", letterSpacing: 1, fontWeight: 800 }}>{label}</div><div style={{ fontSize: 25, fontWeight: 900, marginTop: 7 }}>{value}</div></div>)}</div><div style={{ marginTop: 15, background: "#f7f7f4", border: "1px solid #e2e2de", padding: 14, fontFamily: "monospace", fontSize: 10, lineHeight: 1.7 }}>No captured Razorpay verification<br />→ no realized uplift<br /><br />No MANDATE authorization<br />→ no payment-changing tool execution</div></div>
    </section>

    <section style={{ marginTop: 16, background: "white", border: "1px solid #dddcd7", padding: 22 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "end" }}><div><div style={{ fontSize: 10, color: "#777", letterSpacing: 1.5, fontWeight: 800 }}>JUDGE ROUTES</div><h2 style={{ margin: "7px 0 0", fontSize: 25 }}>Run the proof, not the pitch.</h2></div><span style={{ color: "#777", fontSize: 10 }}>{data ? `Last sweep ${new Date(data.generatedAt).toLocaleTimeString()}` : "waiting"}</span></div><div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 16 }}>{[["Flagship payment", data?.links.negotiation, "Agent negotiation → Test Mode Checkout"],["Growth", data?.links.growth, "Verified revenue uplift"],["MCP guard", data?.links.mcp, "Unauthorized → blocked / Authorized → Test Mode"],["Protocols", data?.links.protocols, "Live protocol matrix"]].map(([label, href, detail]) => href ? <a key={label} href={href} style={{ textDecoration: "none", color: "#171717", border: "1px solid #e2e2de", padding: 16, background: "#fbfbf8" }}><strong style={{ display: "block", fontSize: 13 }}>{label}</strong><span style={{ display: "block", marginTop: 7, color: "#666", fontSize: 11, lineHeight: 1.5 }}>{detail}</span><span style={{ display: "block", marginTop: 12, fontSize: 11, fontWeight: 800 }}>Open →</span></a> : null)}</div></section>

    <section style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}><div style={{ background: "#eff6f1", border: "1px solid #c7d9cc", padding: 20 }}><div style={{ fontSize: 10, color: "#1e5b3e", letterSpacing: 1.4, fontWeight: 800 }}>TRACK 01 STORY</div><h3 style={{ fontSize: 23, margin: "7px 0" }}>Grow merchant revenue without giving the agent the keys.</h3><p style={{ color: "#52685b", fontSize: 12, lineHeight: 1.7, margin: 0 }}>Merchant campaigns choose opportunities; MANDATE bounds the authority; MCP exposes tools; Razorpay executes the payment; the audit trail proves what happened.</p></div><div style={{ background: "#171717", color: "white", padding: 20 }}><div style={{ fontSize: 10, color: "#aaa", letterSpacing: 1.4, fontWeight: 800 }}>EVIDENCE RULE</div><h3 style={{ fontSize: 23, margin: "7px 0" }}>No mock success states.</h3><p style={{ color: "#c5c5c0", fontSize: 12, lineHeight: 1.7, margin: 0 }}>Synthetic values remain confined to explicit security simulations. Money-moving success claims require a Razorpay Test Mode object that the gateway can independently verify.</p></div></section>
  </div></main>;
}
