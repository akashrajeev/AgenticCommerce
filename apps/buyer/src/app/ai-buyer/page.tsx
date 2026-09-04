"use client";

import { useState } from "react";

type Plan = { category?: string; keywords: string[]; budgetCeilingPaise: number; priority: "value" | "quality" | "balanced"; rationale: string; source: "model" | "deterministic" };
type Result = { plan: Plan; paymentAuthority: string; budgetSource: string } | null;

const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);

export default function AIBuyerPage() {
  const [request, setRequest] = useState("Find the best ANC headphones for travel, prioritize comfort and battery life, under ₹5,000");
  const [budget, setBudget] = useState("5000");
  const [result, setResult] = useState<Result>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function plan() {
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/agent/plan-intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request, maxSpendPaise: Math.round(Number(budget) * 100) }),
        cache: "no-store",
      });
      const body = await response.json() as Result & { error?: string };
      if (!response.ok || !body.plan) throw new Error(body.error ?? "Unable to plan buyer intent.");
      setResult(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to plan buyer intent.");
    } finally { setBusy(false); }
  }

  const budgetPaise = result?.plan.budgetCeilingPaise ?? Math.round(Number(budget || 0) * 100);

  return <main style={{ minHeight: "100vh", background: "#f5f5f2", color: "#171717", padding: "36px 20px 72px", fontFamily: "Inter, Arial, sans-serif" }}><div style={{ maxWidth: 1080, margin: "0 auto" }}>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 24, marginBottom: 30 }}><div><div style={{ fontSize: 11, color: "#1e5b3e", letterSpacing: 2, fontWeight: 800 }}>BUYER AGENT · CONSTRAINED AI PLANNER</div><h1 style={{ fontSize: 50, lineHeight: 1, letterSpacing: "-.05em", margin: "9px 0 12px" }}>Natural language in. Bounded commerce out.</h1><p style={{ maxWidth: 820, color: "#666", lineHeight: 1.65 }}>The optional model converts intent into a structured shopping plan. The caller-owned hard budget is immutable; MANDATE remains the payment authority.</p></div><a href="/negotiation" style={{ color: "#171717", fontWeight: 800 }}>Open negotiation →</a></header>

    <section style={{ display: "grid", gridTemplateColumns: "1.1fr .9fr", gap: 18 }}>
      <div style={{ background: "white", border: "1px solid #dddcd7", padding: 24 }}><div style={{ fontSize: 10, color: "#777", letterSpacing: 1.5, fontWeight: 800 }}>1 · BUYER INTENT</div><label style={{ display: "block", marginTop: 14, fontSize: 12, fontWeight: 700 }}>What should the agent buy?</label><textarea value={request} onChange={(event) => setRequest(event.target.value)} rows={6} style={{ marginTop: 8, width: "100%", boxSizing: "border-box", padding: 13, border: "1px solid #d9d9d5", font: "inherit", lineHeight: 1.5, resize: "vertical" }} /><label style={{ display: "block", marginTop: 15, fontSize: 12, fontWeight: 700 }}>Hard maximum spend (₹)</label><input value={budget} onChange={(event) => setBudget(event.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" style={{ marginTop: 8, width: "100%", boxSizing: "border-box", padding: 13, border: "1px solid #d9d9d5", font: "inherit" }} /><button disabled={busy} onClick={() => void plan()} style={{ marginTop: 15, padding: "12px 15px", border: 0, background: "#171717", color: "white", fontWeight: 800, cursor: "pointer" }}>{busy ? "Planning…" : "Plan with buyer agent →"}</button>{error ? <div style={{ marginTop: 14, padding: 12, background: "#f6e9e7", border: "1px solid #dfc1bc", color: "#7b302b", fontSize: 11 }}>{error}</div> : null}</div>

      <div style={{ background: "#171717", color: "white", padding: 24 }}><div style={{ fontSize: 10, color: "#aaa", letterSpacing: 1.5, fontWeight: 800 }}>2 · CONSTRAINED PLAN</div>{result ? <><h2 style={{ margin: "9px 0 3px", fontSize: 28 }}>{result.plan.category ?? "General commerce"}</h2><div style={{ color: "#b9d3c2", fontSize: 11, fontWeight: 800 }}>{result.plan.source.toUpperCase()} PLAN · {result.plan.priority.toUpperCase()} PRIORITY</div><div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}><div style={{ border: "1px solid #373737", padding: 14 }}><div style={{ fontSize: 9, color: "#aaa", letterSpacing: 1 }}>HARD BUDGET</div><strong style={{ display: "block", marginTop: 6, fontSize: 23 }}>{money(result.plan.budgetCeilingPaise)}</strong></div><div style={{ border: "1px solid #373737", padding: 14 }}><div style={{ fontSize: 9, color: "#aaa", letterSpacing: 1 }}>PAYMENT AUTHORITY</div><strong style={{ display: "block", marginTop: 6, fontSize: 14 }}>MANDATE</strong></div></div><div style={{ marginTop: 16, borderTop: "1px solid #373737", paddingTop: 14 }}><div style={{ fontSize: 9, color: "#aaa", letterSpacing: 1 }}>KEYWORDS</div><div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>{result.plan.keywords.map((keyword) => <span key={keyword} style={{ border: "1px solid #444", padding: "6px 8px", fontSize: 10 }}>{keyword}</span>)}</div></div><p style={{ margin: "16px 0 0", color: "#ccc", fontSize: 12, lineHeight: 1.65 }}>{result.plan.rationale}</p></> : <div style={{ color: "#aaa", padding: "42px 0", lineHeight: 1.6 }}>Run the planner to see exactly what the buyer agent inferred. The maximum spend shown here can only equal the caller-supplied hard limit.</div>}</div>
    </section>

    <section style={{ marginTop: 16, background: "white", border: "1px solid #dddcd7", padding: 20 }}><div style={{ fontSize: 10, color: "#777", letterSpacing: 1.5, fontWeight: 800 }}>TRUST CONTRACT</div><div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 9 }}>{[["Model", "interprets intent"],["Hard budget", money(budgetPaise)],["MANDATE", "authorizes spend"],["Razorpay", "executes Test Mode payment"]].map(([label, value]) => <div key={label} style={{ border: "1px solid #e3e3df", padding: 14 }}><div style={{ fontSize: 9, color: "#777", letterSpacing: 1, fontWeight: 800 }}>{label}</div><strong style={{ display: "block", marginTop: 7, fontSize: 13 }}>{value}</strong></div>)}</div><p style={{ margin: "14px 0 0", color: "#666", fontSize: 11, lineHeight: 1.6 }}>This layer never creates a payment or changes authorization limits. Continue to <a href="/negotiation">negotiation</a> to turn the constrained plan into a merchant offer and then, after MANDATE authorization, a real Razorpay Test Mode transaction.</p></section>
  </div></main>;
}
