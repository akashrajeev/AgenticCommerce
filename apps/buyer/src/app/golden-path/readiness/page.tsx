"use client";

import { useEffect, useState } from "react";

type Check = { key: string; label: string; ok: boolean; detail: string };
type GoldenReadiness = { ready: boolean; mode: string; checks: Check[]; sequence: Array<{ step: number; name: string; route: string; sideEffect: string }> };

export default function GoldenReadinessPage() {
  const [data, setData] = useState<GoldenReadiness | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/golden-path", { cache: "no-store" });
      const body = await response.json() as GoldenReadiness & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Readiness check failed.");
      setData(body);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Readiness check failed."); }
    finally { setBusy(false); }
  }

  useEffect(() => { void refresh(); }, []);

  const passed = data?.checks.filter((check) => check.ok).length ?? 0;
  const total = data?.checks.length ?? 0;

  return <main style={{ minHeight: "100vh", background: "#f5f5f2", color: "#171717", padding: "34px 20px 70px", fontFamily: "Inter, Arial, sans-serif" }}><div style={{ maxWidth: 1080, margin: "0 auto" }}>
    <header style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "end", marginBottom: 28 }}><div><div style={{ fontSize: 11, color: "#1e5b3e", fontWeight: 800, letterSpacing: 2 }}>RAZORPAY TEST MODE · GOLDEN PATH READINESS</div><h1 style={{ fontSize: 48, lineHeight: 1, letterSpacing: "-.045em", margin: "9px 0 12px" }}>Prove the rail before you prove the payment.</h1><p style={{ maxWidth: 780, color: "#666", lineHeight: 1.7, margin: 0 }}>This page performs configuration and service checks only. It never creates a payment and never substitutes simulated success for Razorpay evidence.</p></div><div style={{ display: "flex", gap: 8 }}><button onClick={() => void refresh()} disabled={busy} style={{ border: 0, background: "#171717", color: "white", padding: "11px 14px", fontWeight: 800 }}>{busy ? "Checking…" : "Refresh"}</button><a href="/golden-path" style={{ padding: "11px 14px", border: "1px solid #ccc", color: "#171717", textDecoration: "none", fontWeight: 800 }}>Open golden path →</a></div></header>

    {error ? <div style={{ marginBottom: 14, padding: 13, background: "#f6e9e7", border: "1px solid #dfc1bc", color: "#7b302b", fontSize: 12 }}>{error}</div> : null}

    <section style={{ background: data?.ready ? "#171717" : "#5a332d", color: "white", padding: 22, display: "flex", justifyContent: "space-between", alignItems: "end", gap: 20 }}><div><div style={{ fontSize: 10, letterSpacing: ".12em", color: "#aaa", fontWeight: 800 }}>VERDICT</div><h2 style={{ fontSize: 30, margin: "8px 0" }}>{data?.ready ? "READY FOR REAL TEST MODE CHECKOUT" : "BLOCKED UNTIL LIVE TEST MODE PREREQUISITES PASS"}</h2><div style={{ color: "#c9c9c5", fontSize: 12 }}>{passed}/{total} readiness checks passing</div></div><div style={{ fontFamily: "monospace", fontSize: 11 }}>{data?.mode ?? "checking"}</div></section>

    <section style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1.15fr", gap: 14 }}><div style={{ background: "white", border: "1px solid #dddcd7", padding: 20 }}><div style={{ fontSize: 10, color: "#777", letterSpacing: 1.3, fontWeight: 800 }}>LIVE CHECKS</div><div style={{ marginTop: 13, display: "grid", gap: 8 }}>{data?.checks.map((check) => <div key={check.key} style={{ display: "grid", gridTemplateColumns: "8px 1fr auto", gap: 10, alignItems: "center", border: "1px solid #e7e7e2", padding: 12 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: check.ok ? "#6ba181" : "#b96c64" }} /><div><strong style={{ fontSize: 12 }}>{check.label}</strong><div style={{ color: "#777", marginTop: 3, fontSize: 10 }}>{check.detail}</div></div><span style={{ fontSize: 9, fontWeight: 900 }}>{check.ok ? "PASS" : "BLOCKED"}</span></div>)}</div></div>

      <div style={{ background: "white", border: "1px solid #dddcd7", padding: 20 }}><div style={{ fontSize: 10, color: "#777", letterSpacing: 1.3, fontWeight: 800 }}>EXACT TRACK 01 SEQUENCE</div><div style={{ marginTop: 13, display: "grid", gap: 8 }}>{data?.sequence.map((item) => <div key={item.step} style={{ display: "grid", gridTemplateColumns: "30px 1fr auto", gap: 10, alignItems: "center", padding: "11px 0", borderBottom: "1px solid #eee" }}><span style={{ fontFamily: "monospace", fontSize: 10, color: "#888" }}>{String(item.step).padStart(2, "0")}</span><div><strong style={{ fontSize: 13 }}>{item.name}</strong><div style={{ color: "#777", fontSize: 10, marginTop: 3 }}>{item.sideEffect}</div></div><a href={item.route} style={{ color: "#173e2b", fontSize: 10, fontWeight: 800, textDecoration: "none" }}>OPEN →</a></div>)}</div></div></section>

    <section style={{ marginTop: 14, background: "#eff6f1", border: "1px solid #c7d9cc", padding: 18 }}><strong style={{ color: "#1e5b3e", fontSize: 12 }}>Evidence contract</strong><div style={{ color: "#52685b", fontSize: 11, lineHeight: 1.7, marginTop: 6 }}>Only captured Razorpay Test Mode objects independently re-read and bound to the originating MANDATE transaction can contribute to merchant revenue uplift. Security simulations never count as revenue.</div></section>
  </div></main>;
}
