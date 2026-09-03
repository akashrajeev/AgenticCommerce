"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Discovery = {
  merchant: { name: string; merchantId: string; version: string; currency: string };
  agent: { agentId: string; agentType: string; name: string; issuer?: string };
  schemaVersion: string;
  selectedProtocol: string;
  selectedProtocolVersion?: string;
  protocols: Array<{ protocol: string; version: string; status: string; role: string; capabilities: string[] }>;
  capabilities: Array<{ capabilityId: string; name: string; version: string; protocol: string; methods: string[]; endpoint: string; requiresAuthentication: boolean }>;
  payments: Array<{ rail: string; environment: string; methods: string[]; capabilities: string[] }>;
  discovery: { wellKnown: string; capabilities: string };
};

export default function CapabilitiesPage() {
  const [data, setData] = useState<Discovery | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/agent/discovery", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? "DISCOVERY_FAILED");
        return body as Discovery;
      })
      .then(setData)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "DISCOVERY_FAILED"));
  }, []);

  return (
    <main style={{ minHeight: "100vh", background: "#f7f7f3", color: "#171717", fontFamily: "Arial, sans-serif", padding: "36px 20px 72px" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 30 }}>
          <Link href="/labs" style={{ textDecoration: "none", color: "#666", fontSize: 13 }}>← Judge labs</Link>
          <span style={{ border: "1px solid #c8d8ce", background: "#eff6f1", color: "#1e5b3e", padding: "7px 10px", fontSize: 11, fontWeight: 700 }}>AGENT DISCOVERY</span>
        </div>

        <div style={{ borderTop: "2px solid #171717", paddingTop: 18 }}>
          <div style={{ fontSize: 11, letterSpacing: ".12em", fontWeight: 700, color: "#777" }}>PHASE 2 · CAPABILITY HANDSHAKE</div>
          <h1 style={{ fontSize: 56, lineHeight: 1, letterSpacing: "-.055em", margin: "12px 0 14px", maxWidth: 900 }}>Can another agent understand this merchant?</h1>
          <p style={{ maxWidth: 820, color: "#666", lineHeight: 1.7, margin: 0 }}>The buyer discovers a real machine-readable merchant capability document, validates its shape, selects an actually usable protocol, and exposes the payment and commerce capabilities available to the agent.</p>
        </div>

        {error ? (
          <section style={{ marginTop: 28, background: "#fff", border: "1px solid #dccaca", padding: 24 }}><div style={{ fontSize: 11, letterSpacing: ".1em", fontWeight: 700, color: "#8a3b3b" }}>DISCOVERY FAILED</div><div style={{ marginTop: 10, fontSize: 20 }}>{error}</div></section>
        ) : !data ? (
          <section style={{ marginTop: 28, background: "#fff", border: "1px solid #dddcd7", padding: 24, color: "#666" }}>Discovering merchant capabilities…</section>
        ) : (
          <>
            <section style={{ marginTop: 28, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
              <Metric label="MERCHANT" value={data.merchant.name} detail={data.merchant.merchantId} />
              <Metric label="MERCHANT AGENT" value={data.agent.name} detail={data.agent.agentId} />
              <Metric label="SELECTED PROTOCOL" value={data.selectedProtocol} detail={`v${data.selectedProtocolVersion ?? "—"}`} />
            </section>

            <section style={{ marginTop: 18, background: "white", border: "1px solid #dddcd7", padding: 24 }}>
              <div style={{ fontSize: 11, letterSpacing: ".1em", fontWeight: 700, color: "#777" }}>PROTOCOL NEGOTIATION</div>
              <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
                {data.protocols.map((protocol) => (
                  <div key={protocol.protocol} style={{ display: "grid", gridTemplateColumns: "1.2fr .9fr .9fr 2fr", gap: 12, padding: "13px 0", borderTop: "1px solid #eee" }}>
                    <strong>{protocol.protocol}</strong><span>v{protocol.version}</span><Status value={protocol.status} /><span style={{ color: "#666", fontSize: 13 }}>{protocol.capabilities.join(" · ") || "No advertised capability"}</span>
                  </div>
                ))}
              </div>
            </section>

            <section style={{ marginTop: 18, background: "white", border: "1px solid #dddcd7", padding: 24 }}>
              <div style={{ fontSize: 11, letterSpacing: ".1em", fontWeight: 700, color: "#777" }}>REAL MERCHANT CAPABILITIES</div>
              <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                {data.capabilities.map((capability) => (
                  <div key={capability.capabilityId} style={{ border: "1px solid #e5e3de", padding: 16 }}>
                    <div style={{ fontSize: 17, fontWeight: 700 }}>{capability.name}</div>
                    <div style={{ color: "#666", fontSize: 12, marginTop: 8 }}>{capability.methods.join(" / ")} · {capability.endpoint}</div>
                    <div style={{ color: "#1e5b3e", fontSize: 11, fontWeight: 700, marginTop: 10 }}>{capability.protocol.toUpperCase()} · v{capability.version} · {capability.requiresAuthentication ? "AUTHENTICATED" : "PUBLIC"}</div>
                  </div>
                ))}
              </div>
            </section>

            <section style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ background: "#171717", color: "white", padding: 24 }}>
                <div style={{ fontSize: 11, color: "#bcbcb8", letterSpacing: ".1em", fontWeight: 700 }}>PAYMENT RAIL</div>
                {data.payments.map((payment) => <div key={payment.rail} style={{ marginTop: 14 }}><div style={{ fontSize: 25 }}>{payment.rail}</div><div style={{ color: "#bcbcb8", fontSize: 13, marginTop: 6 }}>{payment.environment.toUpperCase()} · {payment.methods.join(" · ")}</div><div style={{ color: "#bcbcb8", fontSize: 12, marginTop: 10 }}>{payment.capabilities.join(" · ")}</div></div>)}
              </div>
              <div style={{ background: "white", border: "1px solid #dddcd7", padding: 24 }}>
                <div style={{ fontSize: 11, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>DISCOVERY CONTRACT</div>
                <div style={{ marginTop: 14, fontFamily: "monospace", fontSize: 13, lineHeight: 1.8 }}>{data.discovery.wellKnown}<br />{data.discovery.capabilities}</div>
                <div style={{ marginTop: 14, color: "#666", fontSize: 12 }}>Schema version {data.schemaVersion}. Capability discovery grants no payment authority.</div>
              </div>
            </section>

            <section style={{ marginTop: 18, background: "#eff6f1", border: "1px solid #c8d8ce", padding: 24 }}>
              <div style={{ fontSize: 11, letterSpacing: ".1em", fontWeight: 700, color: "#1e5b3e" }}>AUTHORITY BOUNDARY</div>
              <div style={{ marginTop: 10, fontSize: 20, lineHeight: 1.45 }}>Discovery tells an agent what the merchant can do. It does not authorize a payment. Payment authority still terminates at the MANDATE gateway.</div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div style={{ background: "white", border: "1px solid #dddcd7", padding: 20 }}><div style={{ fontSize: 10, letterSpacing: ".1em", fontWeight: 700, color: "#777" }}>{label}</div><div style={{ fontSize: 23, fontWeight: 700, marginTop: 12 }}>{value}</div><div style={{ fontSize: 12, color: "#666", marginTop: 6, fontFamily: "monospace" }}>{detail}</div></div>;
}

function Status({ value }: { value: string }) {
  const active = value === "implemented" || value === "compatible";
  return <span style={{ alignSelf: "start", display: "inline-flex", width: "fit-content", padding: "5px 8px", background: active ? "#eff6f1" : "#f4f3ef", color: active ? "#1e5b3e" : "#6b6b66", border: `1px solid ${active ? "#c8d8ce" : "#dddcd7"}`, fontSize: 10, fontWeight: 700 }}>{value.toUpperCase()}</span>;
}
