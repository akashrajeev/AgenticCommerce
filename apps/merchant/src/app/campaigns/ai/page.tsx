"use client";

import { useState } from "react";

type Plan = {
  campaignId: string;
  strategy: "CROSS_SELL" | "UPSELL";
  sourceProductId: string;
  targetProductId: string;
  audience: string;
  rationale: string;
  evidence: Array<{ metric: string; value: string }>;
  guardrails: string[];
  expectedIncrementalRevenuePaise: number;
  confidence: number;
};
type Result = { plan?: Plan; model?: string; liveEvidence?: { confirmedOrders: number; confirmedRevenuePaise: number; realizedIncrementalRevenuePaise: number }; execution?: { allowed: boolean; nextRoute: string; reason: string }; error?: string } | null;

const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);

export default function AIGrowthAdvisorPage() {
  const [objective, setObjective] = useState("Increase average basket value for headphone buyers while staying inside the buyer's spending limit.");
  const [result, setResult] = useState<Result>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/ai-growth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ objective }), cache: "no-store" });
      const body = await response.json() as Result;
      setResult(body);
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "AI_GROWTH_FAILED" });
    } finally { setBusy(false); }
  }

  return <main style={{ minHeight: "100vh", background: "#f6f5f1", color: "#171717", padding: 36, fontFamily: "Inter, Arial, sans-serif" }}><div style={{ maxWidth: 1120, margin: "0 auto" }}>
    <header style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "end", marginBottom: 28 }}><div><div style={{ fontSize: 11, color: "#1e5b3e", letterSpacing: 2, fontWeight: 800 }}>AI GROWTH COPILOT · READ-ONLY PLANNING</div><h1 style={{ fontSize: 50, lineHeight: 1, letterSpacing: "-.05em", margin: "8px 0 12px" }}>Let the model find the growth move.<br /><span style={{ color: "#8f7c65" }}>Keep payment authority outside the model.</span></h1><p style={{ maxWidth: 850, color: "#666", lineHeight: 1.6 }}>The model sees current catalog, campaign opportunities and confirmed merchant-order evidence. It can recommend an existing opportunity, but it cannot invent a product, create a payment, or authorize spend.</p></div><div style={{ display: "grid", gap: 8 }}><a href="/campaigns" style={{ padding: "10px 12px", background: "#171717", color: "white", textDecoration: "none", fontSize: 11, fontWeight: 800 }}>Campaign orchestrator →</a><a href="/campaigns/attribution" style={{ padding: "10px 12px", border: "1px solid #ccc", color: "#171717", textDecoration: "none", fontSize: 11, fontWeight: 800 }}>Attribution evidence →</a></div></header>

    <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <div style={{ background: "white", border: "1px solid #dddcd7", padding: 22 }}><div style={{ fontSize: 10, color: "#777", letterSpacing: 1.2, fontWeight: 800 }}>GROWTH OBJECTIVE</div><textarea value={objective} onChange={(event) => setObjective(event.target.value)} rows={6} style={{ marginTop: 12, width: "100%", boxSizing: "border-box", border: "1px solid #d8d7d2", padding: 14, resize: "vertical", font: "inherit", lineHeight: 1.5, background: "#fafaf7" }} /><button disabled={busy || objective.trim().length < 5} onClick={() => void run()} style={{ marginTop: 12, border: 0, background: "#171717", color: "white", padding: "12px 14px", fontWeight: 800, cursor: "pointer" }}>{busy ? "Reasoning over live merchant data…" : "Generate grounded growth plan →"}</button><div style={{ marginTop: 14, color: "#777", fontSize: 10, lineHeight: 1.6 }}>Data boundary: merchant catalog + existing campaigns + persisted confirmed merchant orders. Payment boundary: MANDATE + Razorpay Test Mode.</div></div>

      <div style={{ background: "#171717", color: "white", padding: 22 }}><div style={{ fontSize: 10, color: "#aaa", letterSpacing: 1.2, fontWeight: 800 }}>LIVE EVIDENCE SUPPLIED TO MODEL</div>{result?.liveEvidence ? <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>{[["Confirmed orders", String(result.liveEvidence.confirmedOrders)], ["Confirmed revenue", money(result.liveEvidence.confirmedRevenuePaise)], ["Realized uplift", money(result.liveEvidence.realizedIncrementalRevenuePaise)], ["Payment rail", "Razorpay Test Mode"]].map(([label, value]) => <div key={label} style={{ border: "1px solid #353535", padding: 14 }}><div style={{ fontSize: 9, color: "#aaa", letterSpacing: 1 }}>{label}</div><strong style={{ display: "block", marginTop: 7, fontSize: 21 }}>{value}</strong></div>)}</div> : <div style={{ marginTop: 14, color: "#aaa", lineHeight: 1.6, fontSize: 12 }}>Run the advisor to see the exact merchant evidence context used for reasoning.</div> }</div>
    </section>

    {result?.error ? <section style={{ marginTop: 16, background: "#f6e9e7", border: "1px solid #dfc1bc", padding: 16, color: "#7b302b", fontSize: 12 }}>{result.error === "AI_GROWTH_NOT_CONFIGURED" ? "AI advisor is not configured. Set OPENAI_API_KEY server-side; no fallback or fake AI response is used." : result.error}</section> : null}

    {result?.plan ? <section style={{ marginTop: 16, background: "white", border: "1px solid #dddcd7", padding: 24 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "end" }}><div><div style={{ fontSize: 10, color: "#777", letterSpacing: 1.2, fontWeight: 800 }}>GROUNDED AI PLAN</div><h2 style={{ margin: "7px 0 0", fontSize: 31 }}>{result.plan.strategy} · {result.plan.campaignId}</h2></div><div style={{ textAlign: "right" }}><div style={{ fontSize: 9, color: "#777", letterSpacing: 1 }}>MODEL CONFIDENCE</div><strong style={{ fontSize: 27 }}>{Math.round(result.plan.confidence * 100)}%</strong><div style={{ fontSize: 9, color: "#777", marginTop: 2 }}>{result.model}</div></div></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 20 }}><div><div style={{ fontSize: 10, color: "#777", letterSpacing: 1, fontWeight: 800 }}>RECOMMENDATION</div><div style={{ marginTop: 8, fontSize: 17, fontWeight: 800 }}>{result.plan.sourceProductId} → {result.plan.targetProductId}</div><p style={{ color: "#666", lineHeight: 1.65, fontSize: 12 }}>{result.plan.rationale}</p><div style={{ marginTop: 14, fontSize: 10, color: "#777", letterSpacing: 1, fontWeight: 800 }}>AUDIENCE</div><p style={{ color: "#555", lineHeight: 1.55, fontSize: 12 }}>{result.plan.audience}</p></div><div><div style={{ fontSize: 10, color: "#777", letterSpacing: 1, fontWeight: 800 }}>MODEL EVIDENCE</div><div style={{ marginTop: 9, display: "grid", gap: 7 }}>{result.plan.evidence.map((item, index) => <div key={`${item.metric}-${index}`} style={{ borderLeft: "3px solid #c8d8ce", padding: "8px 0 8px 10px", fontSize: 11 }}><strong>{item.metric}</strong><div style={{ color: "#666", marginTop: 3 }}>{item.value}</div></div>)}</div><div style={{ marginTop: 14, fontSize: 10, color: "#777", letterSpacing: 1, fontWeight: 800 }}>GUARDRAILS</div><div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>{result.plan.guardrails.map((guardrail) => <span key={guardrail} style={{ padding: "6px 8px", background: "#f0f6f2", border: "1px solid #d4e2d8", color: "#1e5b3e", fontSize: 9 }}>{guardrail}</span>)}</div></div></div>
      <div style={{ marginTop: 20, borderTop: "1px solid #e6e4df", paddingTop: 16, display: "flex", justifyContent: "space-between", gap: 20, alignItems: "center" }}><div><div style={{ fontSize: 10, color: "#777", letterSpacing: 1, fontWeight: 800 }}>EXPECTED INCREMENTAL VALUE</div><strong style={{ fontSize: 25 }}>+{money(result.plan.expectedIncrementalRevenuePaise)}</strong><div style={{ color: "#777", fontSize: 10, marginTop: 4 }}>Expectation only; no payment has been counted.</div></div><a href={result.execution?.nextRoute ?? "/campaigns"} style={{ background: "#171717", color: "white", textDecoration: "none", padding: "12px 14px", fontSize: 11, fontWeight: 800 }}>Review in campaign orchestrator →</a></div>
    </section> : null}
  </div></main>;
}
