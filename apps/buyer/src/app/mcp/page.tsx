"use client";

import { useState } from "react";

type Result = { status?: number; body?: unknown } | null;

const moneyText = (value: unknown) => typeof value === "number" ? `₹${(value / 100).toFixed(2)}` : "—";

export default function McpLabPage() {
  const [discover, setDiscover] = useState<Result>(null);
  const [tools, setTools] = useState<Result>(null);
  const [unauthorized, setUnauthorized] = useState<Result>(null);
  const [guard, setGuard] = useState<Result>(null);
  const [busy, setBusy] = useState("");

  async function run(action: string, setter: (result: Result) => void) {
    setBusy(action);
    try {
      const response = await fetch("/api/mcp-lab", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }), cache: "no-store" });
      setter(await response.json());
    } catch (error) {
      setter({ status: 502, body: { error: error instanceof Error ? error.message : "MCP_LAB_FAILED" } });
    } finally {
      setBusy("");
    }
  }

  const pretty = (value: unknown) => JSON.stringify(value, null, 2);
  const guardBody = guard?.body as { body?: { result?: { isError?: boolean; content?: Array<{ text?: string }> } } } | undefined;
  const guardText = guardBody?.body?.result?.content?.[0]?.text;

  return (
    <main style={{ minHeight: "100vh", background: "#f4f4f2", color: "#171717", fontFamily: "Inter, Arial, sans-serif", padding: 32 }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 24, marginBottom: 32 }}>
          <div>
            <div style={{ letterSpacing: 2, fontSize: 12, fontWeight: 700, color: "#666" }}>PHASE 9 / MCP POLICY GATE</div>
            <h1 style={{ margin: "8px 0", fontSize: 44, lineHeight: 1 }}>MCP can request. MANDATE decides.</h1>
            <p style={{ maxWidth: 760, color: "#555", fontSize: 17, lineHeight: 1.5 }}>This lab proves that an agent-facing MCP tool surface does not become a payment authority. The browser never receives the MCP bearer token or the gateway secret.</p>
          </div>
          <a href="/negotiation" style={{ color: "#171717", fontWeight: 700 }}>Open flagship payment flow →</a>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20 }}>
          <div style={{ background: "white", border: "1px solid #ddd", borderRadius: 18, padding: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: "#666", marginBottom: 16 }}>ATTACK / TRUST BOUNDARY</div>
            <div style={{ display: "grid", gap: 14 }}>
              <button disabled={!!busy} onClick={() => void run("unauthorized", setUnauthorized)} style={{ textAlign: "left", padding: 18, borderRadius: 14, border: "1px solid #ddd", background: "#fafafa", cursor: "pointer" }}>
                <strong>1. Call MCP without a token</strong><div style={{ color: "#666", marginTop: 5 }}>Expected: HTTP 401 before any tool can run.</div>
              </button>
              <button disabled={!!busy} onClick={() => void run("discover", setDiscover)} style={{ textAlign: "left", padding: 18, borderRadius: 14, border: "1px solid #ddd", background: "#fafafa", cursor: "pointer" }}>
                <strong>2. Discover the current MCP server</strong><div style={{ color: "#666", marginTop: 5 }}>Expected: stateless 2026-07-28 `server/discover` response.</div>
              </button>
              <button disabled={!!busy} onClick={() => void run("tools", setTools)} style={{ textAlign: "left", padding: 18, borderRadius: 14, border: "1px solid #ddd", background: "#fafafa", cursor: "pointer" }}>
                <strong>3. List payment tools</strong><div style={{ color: "#666", marginTop: 5 }}>Expected: four guarded Razorpay operations.</div>
              </button>
              <button disabled={!!busy} onClick={() => void run("guard", setGuard)} style={{ textAlign: "left", padding: 18, borderRadius: 14, border: "1px solid #ddd", background: "#fafafa", cursor: "pointer" }}>
                <strong>4. Attempt capture without MANDATE authorization</strong><div style={{ color: "#666", marginTop: 5 }}>Expected: MCP request is accepted, but the payment operation fails closed at the MANDATE boundary.</div>
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gap: 20 }}>
            <ResultCard title="Unauthenticated client" result={unauthorized} accent={unauthorized?.status === 401 ? "BLOCKED" : undefined} pretty={pretty} />
            <ResultCard title="MCP discover" result={discover} pretty={pretty} />
            <ResultCard title="Available tools" result={tools} pretty={pretty} />
            <div style={{ background: "#171717", color: "white", borderRadius: 18, padding: 22 }}>
              <div style={{ fontSize: 11, letterSpacing: 1.4, fontWeight: 700, color: "#aaa" }}>MANDATE GUARD</div>
              <div style={{ fontSize: 24, fontWeight: 800, marginTop: 5 }}>{guard?.status === 200 && guardText ? "BLOCKED BEFORE PAYMENT" : "Awaiting test"}</div>
              <div style={{ marginTop: 8, color: "#bbb", lineHeight: 1.45 }}>{guardText ?? "Run the guarded capture test to see the trusted gateway reject an unbound payment operation."}</div>
            </div>
          </div>
        </section>

        <section style={{ marginTop: 20, background: "white", border: "1px solid #ddd", borderRadius: 18, padding: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: "#666" }}>TRUST MODEL</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 16 }}>
            {[["Agent", "Requests / proposals"], ["MCP facade", "Authentication + tool boundary"], ["MANDATE", "Authorization + deterministic policy"], ["Razorpay", "Payment rail"]].map(([label, detail]) => <div key={label} style={{ padding: 16, border: "1px solid #e3e3e3", borderRadius: 14 }}><strong>{label}</strong><div style={{ marginTop: 6, color: "#666", fontSize: 14 }}>{detail}</div></div>)}
          </div>
        </section>
      </div>
    </main>
  );
}

function ResultCard({ title, result, accent, pretty }: { title: string; result: Result; accent?: string; pretty: (value: unknown) => string }) {
  return <div style={{ background: "white", border: "1px solid #ddd", borderRadius: 18, padding: 20 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><strong>{title}</strong>{result?.status ? <span style={{ fontSize: 11, fontWeight: 800 }}>{accent ?? `HTTP ${result.status}`}</span> : null}</div><pre style={{ margin: "12px 0 0", padding: 12, background: "#f7f7f5", borderRadius: 12, overflow: "auto", maxHeight: 180, fontSize: 11 }}>{result ? pretty(result) : "No result yet."}</pre></div>;
}
