"use client";

import { useState } from "react";

type Result = { status: number; body: unknown } | null;

export default function AuthorizedMcpLab() {
  const [blocked, setBlocked] = useState<Result>(null);
  const [authorized, setAuthorized] = useState<Result>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: "guard" | "authorized-test-order", setter: (value: Result) => void) {
    setBusy(true);
    try {
      const response = await fetch("/api/mcp-lab", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
        cache: "no-store",
      });
      setter({ status: response.status, body: await response.json().catch(() => null) });
    } catch (error) {
      setter({ status: 502, body: { error: error instanceof Error ? error.message : "MCP_LAB_FAILED" } });
    } finally {
      setBusy(false);
    }
  }

  const blockedBody = blocked?.body as { result?: { content?: Array<{ text?: string }> }; body?: unknown } | undefined;
  const authorizedBody = authorized?.body as { result?: { content?: Array<{ text?: string }>; structuredContent?: Record<string, unknown> }; proof?: string; body?: unknown } | undefined;
  const blockedText = blockedBody?.result?.content?.[0]?.text;
  const authorizedText = authorizedBody?.result?.content?.[0]?.text;
  const authorizedProof = authorizedBody?.proof;

  return (
    <main style={{ minHeight: "100vh", background: "#f4f4f2", color: "#171717", padding: 36, fontFamily: "Inter, Arial, sans-serif" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 24, alignItems: "end" }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 2, fontWeight: 800, color: "#6b6b67" }}>JUDGE DEMO · REAL RAZORPAY TEST MODE</div>
            <h1 style={{ fontSize: 50, lineHeight: .98, margin: "10px 0", letterSpacing: "-.05em" }}>MCP can request. MANDATE decides.</h1>
            <p style={{ maxWidth: 760, color: "#60605c", lineHeight: 1.65, margin: 0 }}>The negative path creates a real gateway transaction but stops before Razorpay. The positive path reuses a real mandate-authorized transaction and asks the MCP facade to create a real Razorpay Test Mode order.</p>
          </div>
          <a href="/mcp" style={{ color: "#171717", fontWeight: 700, textDecoration: "none" }}>← MCP policy lab</a>
        </header>

        <section style={{ marginTop: 30, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <article style={{ background: "#fbefed", border: "1px solid #dfc4bf", padding: 24 }}>
            <div style={{ color: "#8b342d", fontSize: 10, letterSpacing: 1.6, fontWeight: 800 }}>A · UNAUTHORIZED PAYMENT TOOL</div>
            <h2 style={{ fontSize: 27, margin: "9px 0" }}>Blocked before Razorpay</h2>
            <p style={{ color: "#6a5c58", fontSize: 12, lineHeight: 1.6 }}>Creates a real transaction from the merchant quote, then calls MCP capture with an invalid authorization. The gateway must reject it before any Test Mode payment action.</p>
            <button disabled={busy} onClick={() => void run("guard", setBlocked)} style={{ marginTop: 12, padding: "11px 13px", border: 0, background: "#171717", color: "white", fontWeight: 800, cursor: "pointer" }}>Run blocked path</button>
            <div style={{ marginTop: 16, background: "white", border: "1px solid #e0d8d5", padding: 14, fontFamily: "monospace", fontSize: 11, minHeight: 120, overflow: "auto" }}>{blocked ? JSON.stringify(blocked.body, null, 2) : "awaiting proof"}</div>
            <div style={{ marginTop: 10, fontSize: 11, fontWeight: 800, color: blockedText ? "#8b342d" : "#777" }}>{blockedText ?? "Expected: MANDATE_AUTHORIZATION_REQUIRED / mismatch"}</div>
          </article>

          <article style={{ background: "#eff6f1", border: "1px solid #c7d9cc", padding: 24 }}>
            <div style={{ color: "#1e5b3e", fontSize: 10, letterSpacing: 1.6, fontWeight: 800 }}>B · AUTHORIZED PAYMENT TOOL</div>
            <h2 style={{ fontSize: 27, margin: "9px 0" }}>Real Test Mode order</h2>
            <p style={{ color: "#5c6b61", fontSize: 12, lineHeight: 1.6 }}>Uses an existing policy-authorized MANDATE transaction. No amount is supplied by the agent; the gateway transaction remains authoritative and the MCP facade creates/reuses the real Razorpay Test Mode order.</p>
            <button disabled={busy} onClick={() => void run("authorized-test-order", setAuthorized)} style={{ marginTop: 12, padding: "11px 13px", border: 0, background: "#1e5b3e", color: "white", fontWeight: 800, cursor: "pointer" }}>Run authorized path</button>
            <div style={{ marginTop: 16, background: "white", border: "1px solid #d9e4dc", padding: 14, fontFamily: "monospace", fontSize: 11, minHeight: 120, overflow: "auto" }}>{authorized ? JSON.stringify(authorized.body, null, 2) : "awaiting a real policy-authorized transaction"}</div>
            <div style={{ marginTop: 10, fontSize: 11, fontWeight: 800, color: authorizedProof?.includes("RAZORPAY") ? "#1e5b3e" : "#777" }}>{authorizedText ?? authorizedProof ?? "Expected: real order ID from Razorpay Test Mode"}</div>
          </article>
        </section>

        <section style={{ marginTop: 16, background: "#171717", color: "white", padding: 24 }}>
          <div style={{ fontSize: 10, letterSpacing: 1.5, color: "#a9a9a5", fontWeight: 800 }}>WHAT THIS PROVES</div>
          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            {["MCP authentication", "MANDATE authorization", "Razorpay Test Mode", "No model-controlled amount"].map((label) => <div key={label} style={{ border: "1px solid #373737", padding: 13, fontSize: 12, fontWeight: 700 }}>{label}</div>)}
          </div>
        </section>
      </div>
    </main>
  );
}
