"use client";

import { useState } from "react";

type Result = { status?: number; body?: unknown } | null;

type BoundaryResult = {
  scenario?: string;
  expected?: { unauthenticated: number; authenticated: number };
  unauthorized?: Result;
  authorized?: Result;
  proof?: string;
};

export default function McpLabPage() {
  const [discover, setDiscover] = useState<Result>(null);
  const [tools, setTools] = useState<Result>(null);
  const [unauthorized, setUnauthorized] = useState<Result>(null);
  const [boundary, setBoundary] = useState<BoundaryResult | null>(null);
  const [guard, setGuard] = useState<Result>(null);
  const [explanation, setExplanation] = useState<Result>(null);
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
  const boundaryConfirmed = boundary?.proof === "AUTHENTICATION_BOUNDARY_CONFIRMED";

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
              <button disabled={!!busy} onClick={() => void run("auth-boundary", setBoundary as unknown as (result: Result) => void)} style={{ textAlign: "left", padding: 18, borderRadius: 14, border: "1px solid #c8d8ce", background: "#f5faf6", cursor: "pointer" }}>
                <strong>1. Prove unauthenticated vs authenticated MCP access</strong><div style={{ color: "#666", marginTop: 5 }}>One click: missing bearer → 401, server-issued bearer → 200. The secret stays server-side.</div>
              </button>
              <button disabled={!!busy} onClick={() => void run("unauthorized", setUnauthorized)} style={{ textAlign: "left", padding: 18, borderRadius: 14, border: "1px solid #ddd", background: "#fafafa", cursor: "pointer" }}>
                <strong>2. Call MCP without a token</strong><div style={{ color: "#666", marginTop: 5 }}>Expected: HTTP 401 before any tool can run.</div>
              </button>
              <button disabled={!!busy} onClick={() => void run("discover", setDiscover)} style={{ textAlign: "left", padding: 18, borderRadius: 14, border: "1px solid #ddd", background: "#fafafa", cursor: "pointer" }}>
                <strong>3. Discover the current MCP server</strong><div style={{ color: "#666", marginTop: 5 }}>Expected: stateless 2026-07-28 `server/discover` response.</div>
              </button>
              <button disabled={!!busy} onClick={() => void run("tools", setTools)} style={{ textAlign: "left", padding: 18, borderRadius: 14, border: "1px solid #ddd", background: "#fafafa", cursor: "pointer" }}>
                <strong>4. List payment tools</strong><div style={{ color: "#666", marginTop: 5 }}>Expected: six guarded Razorpay operations.</div>
              </button>
              <button disabled={!!busy} onClick={() => void run("guard", setGuard)} style={{ textAlign: "left", padding: 18, borderRadius: 14, border: "1px solid #ddd", background: "#fafafa", cursor: "pointer" }}>
                <strong>5. Attempt capture without MANDATE authorization</strong><div style={{ color: "#666", marginTop: 5 }}>Expected: MCP request is accepted, but the payment operation fails closed at the MANDATE boundary.</div>
              </button>
              <button disabled={!!busy} onClick={() => void run("explain", setExplanation)} style={{ textAlign: "left", padding: 18, borderRadius: 14, border: "1px solid #c8d8ce", background: "#f5faf6", cursor: "pointer" }}>
                <strong>6. Explain the latest payment decision</strong><div style={{ color: "#666", marginTop: 5 }}>Read-only: intent, quote, mandate binding, policy checks, Razorpay references and audit timeline. No payment side effect.</div>
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gap: 20 }}>
            <div style={{ background: boundaryConfirmed ? "#eef7f1" : "white", border: `1px solid ${boundaryConfirmed ? "#b9d3c2" : "#ddd"}`, borderRadius: 18, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}><strong>Authentication boundary</strong>{boundary && <span style={{ fontSize: 11, fontWeight: 800 }}>{boundaryConfirmed ? "CONFIRMED" : "NOT CONFIRMED"}</span>}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
                <BoundaryCell label="Without bearer" result={boundary?.unauthorized} expected={401} />
                <BoundaryCell label="With server-side bearer" result={boundary?.authorized} expected={200} />
              </div>
              <div style={{ marginTop: 12, color: "#666", fontSize: 11, lineHeight: 1.5 }}>{boundary ? `Expected 401 → 200 · observed ${boundary.unauthorized?.status ?? "—"} → ${boundary.authorized?.status ?? "—"}` : "Run the proof to make the trust boundary visible to a judge."}</div>
            </div>
            <ResultCard title="Unauthenticated client" result={unauthorized} accent={unauthorized?.status === 401 ? "BLOCKED" : undefined} pretty={pretty} />
            <ResultCard title="MCP discover" result={discover} pretty={pretty} />
            <ResultCard title="Available tools" result={tools} pretty={pretty} />
            <div style={{ background: "#171717", color: "white", borderRadius: 18, padding: 22 }}>
              <div style={{ fontSize: 11, letterSpacing: 1.4, fontWeight: 700, color: "#aaa" }}>MANDATE GUARD</div>
              <div style={{ fontSize: 24, fontWeight: 800, marginTop: 5 }}>{guard?.status === 200 && guardText ? "BLOCKED BEFORE PAYMENT" : "Awaiting test"}</div>
              <div style={{ marginTop: 8, color: "#bbb", lineHeight: 1.45 }}>{guardText ?? "Run the guarded capture test to see the trusted gateway reject an unbound payment operation."}</div>
            </div>
            <ResultCard title="Read-only payment explanation" result={explanation} accent={explanation?.status === 200 ? "NO PAYMENT SIDE EFFECT" : undefined} pretty={pretty} />
          </div>
        </section>

        <section style={{ marginTop: 20, background: "white", border: "1px solid #ddd", borderRadius: 18, padding: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: "#666" }}>TRUST MODEL</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 16 }}>
            {[['Agent', 'Requests / proposals'], ['MCP facade', 'Authentication + tool boundary'], ['MANDATE', 'Authorization + deterministic policy'], ['Razorpay', 'Payment rail']].map(([label, detail]) => <div key={label} style={{ padding: 16, border: "1px solid #e3e3e3", borderRadius: 14 }}><strong>{label}</strong><div style={{ marginTop: 6, color: "#666", fontSize: 14 }}>{detail}</div></div>)}
          </div>
        </section>
      </div>
    </main>
  );
}

function BoundaryCell({ label, result, expected }: { label: string; result?: Result; expected: number }) {
  const ok = result?.status === expected;
  return <div style={{ padding: 14, border: `1px solid ${ok ? "#b9d3c2" : "#ddd"}`, borderRadius: 14, background: ok ? "#f5faf6" : "#fafafa" }}><div style={{ fontSize: 10, color: "#777", letterSpacing: 1 }}>{label}</div><div style={{ fontSize: 26, fontWeight: 800, marginTop: 5 }}>{result?.status ?? "—"}</div><div style={{ color: "#666", fontSize: 10, marginTop: 4 }}>{result ? (ok ? "expected outcome" : `expected HTTP ${expected}`) : "awaiting proof"}</div></div>;
}

function ResultCard({ title, result, accent, pretty }: { title: string; result: Result; accent?: string; pretty: (value: unknown) => string }) {
  return <div style={{ background: "white", border: "1px solid #ddd", borderRadius: 18, padding: 20 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><strong>{title}</strong>{result?.status ? <span style={{ fontSize: 11, fontWeight: 800 }}>{accent ?? `HTTP ${result.status}`}</span> : null}</div><pre style={{ margin: "12px 0 0", padding: 12, background: "#f7f7f5", borderRadius: 12, overflow: "auto", maxHeight: 180, fontSize: 11 }}>{result ? pretty(result) : "No result yet."}</pre></div>;
}