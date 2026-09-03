"use client";

import { useState } from "react";

type Result = { status?: number; paymentRequired?: string | null; body?: unknown } | null;

export default function X402Page() {
  const [health, setHealth] = useState<Result>(null);
  const [challenge, setChallenge] = useState<Result>(null);
  const [busy, setBusy] = useState("");

  async function run(action: "health" | "challenge", setter: (value: Result) => void) {
    setBusy(action);
    try {
      const response = await fetch("/api/x402-lab", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }), cache: "no-store" });
      setter(await response.json());
    } catch (error) {
      setter({ status: 502, body: { error: error instanceof Error ? error.message : "X402_LAB_FAILED" } });
    } finally {
      setBusy("");
    }
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f3f4f2", color: "#171717", padding: 36, fontFamily: "Inter, Arial, sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "end", marginBottom: 30 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: "#666" }}>PHASE 10 / X402 AGENT-TO-SERVICE</div>
            <h1 style={{ fontSize: 46, lineHeight: 1.03, margin: "8px 0 12px" }}>Pay for a service over HTTP. Keep authority in MANDATE.</h1>
            <p style={{ maxWidth: 800, fontSize: 17, lineHeight: 1.5, color: "#555" }}>x402 carries the payment protocol over HTTP. MANDATE adds a separate signed service authorization so the agent cannot turn x402 into unrestricted spending authority.</p>
          </div>
          <a href="/" style={{ fontWeight: 700, color: "#171717" }}>Buyer workspace →</a>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <div style={{ background: "white", border: "1px solid #ddd", borderRadius: 18, padding: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.5, color: "#666" }}>PROTOCOL TRACE</div>
            <div style={{ marginTop: 18, display: "grid", gap: 14 }}>
              <Step n="01" title="Client asks for protected resource" detail="GET /resource" />
              <Step n="02" title="Service returns HTTP 402" detail="PAYMENT-REQUIRED = Base64(JSON PaymentRequired v2)" />
              <Step n="03" title="Agent submits PAYMENT-SIGNATURE" detail="Base64(JSON PaymentPayload v2) + signed MANDATE service authorization" />
              <Step n="04" title="Facilitator verifies and settles" detail="/verify → /settle → PAYMENT-RESPONSE" />
            </div>
            <div style={{ marginTop: 22, padding: 16, background: "#171717", color: "white", borderRadius: 14 }}><strong>Trust rule</strong><div style={{ color: "#bbb", marginTop: 6 }}>x402 proves payment intent; MANDATE decides whether the agent is allowed to spend it.</div></div>
          </div>

          <div style={{ display: "grid", gap: 18 }}>
            <button disabled={!!busy} onClick={() => void run("health", setHealth)} style={{ textAlign: "left", background: "white", border: "1px solid #ddd", borderRadius: 18, padding: 22, cursor: "pointer" }}><strong>Check x402 service</strong><div style={{ color: "#666", marginTop: 6 }}>Verifies the resource server is alive and shows whether facilitator + pay-to are configured.</div>{health && <pre style={{ marginTop: 14, background: "#f7f7f5", padding: 12, overflow: "auto" }}>{JSON.stringify(health, null, 2)}</pre>}</button>
            <button disabled={!!busy} onClick={() => void run("challenge", setChallenge)} style={{ textAlign: "left", background: "white", border: "1px solid #ddd", borderRadius: 18, padding: 22, cursor: "pointer" }}><strong>Request the paid resource</strong><div style={{ color: "#666", marginTop: 6 }}>Expected: HTTP 402 with a standards-shaped PAYMENT-REQUIRED header.</div>{challenge && <pre style={{ marginTop: 14, background: "#f7f7f5", padding: 12, overflow: "auto", maxHeight: 320 }}>{JSON.stringify(challenge, null, 2)}</pre>}</button>
          </div>
        </section>
      </div>
    </main>
  );
}

function Step({ n, title, detail }: { n: string; title: string; detail: string }) {
  return <div style={{ display: "grid", gridTemplateColumns: "42px 1fr", gap: 12, alignItems: "start" }}><span style={{ width: 42, height: 42, borderRadius: "50%", border: "1px solid #ddd", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 800 }}>{n}</span><div><strong>{title}</strong><div style={{ color: "#666", marginTop: 4, fontSize: 14 }}>{detail}</div></div></div>;
}
