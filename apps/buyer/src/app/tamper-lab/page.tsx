"use client";

import Link from "next/link";
import { useState } from "react";

const MERCHANT_URL = process.env.NEXT_PUBLIC_MERCHANT_URL ?? "http://localhost:3000";
const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4000";
const basket = [
  { productId: "hp-001", quantity: 1, name: "SoundMax Pro" },
];

const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);

type Quote = { quoteId: string; totalPaise: number; lineItems: Array<{ productId: string; quantity: number; unitPricePaise: number; lineTotalPaise: number }>; expiresAt: string };
type Transaction = { id: string; state: string; quote: { totalPaise: number }; policy?: { decision: "ALLOW" | "BLOCK"; checks: Array<{ rule: string; result: "PASS" | "FAIL"; observed: string; expected: string; reason: string }> } };
type Result = { actualQuote: Quote; claimedTotalPaise: number; transaction: Transaction; claimAccepted: boolean };

export default function TamperLab() {
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runTamper() {
    setLoading(true); setError(""); setResult(null);
    try {
      const quoteResponse = await fetch(`${MERCHANT_URL}/api/agent/checkout/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineItems: basket }),
        cache: "no-store",
      });
      const quoteBody = await quoteResponse.json() as { quote?: Quote; error?: string };
      if (!quoteResponse.ok || !quoteBody.quote) throw new Error(quoteBody.error ?? "Merchant quote failed.");
      const quote = quoteBody.quote;
      const claimedTotalPaise = Math.max(1, Math.floor(quote.totalPaise * 0.1));
      const firstLine = quote.lineItems[0];
      if (!firstLine) throw new Error("Empty quote.");

      const response = await fetch(`${GATEWAY_URL}/v1/purchase-intents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          merchantId: "mandate-market",
          productId: firstLine.productId,
          quantity: firstLine.quantity,
          lineItems: basket,
          maxSpendPaise: quote.totalPaise + 100000,
          reason: "Security lab: pretend the browser says the basket costs much less",
          quoteId: quote.quoteId,
          claimedTotalPaise,
        }),
        cache: "no-store",
      });
      const body = await response.json() as { transaction?: Transaction; error?: string };
      if (!response.ok || !body.transaction) throw new Error(body.error ?? "Gateway rejected the purchase intent.");
      setResult({ actualQuote: quote, claimedTotalPaise, transaction: body.transaction, claimAccepted: body.transaction.quote.totalPaise === claimedTotalPaise });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Tamper lab failed.");
    } finally { setLoading(false); }
  }

  const resultSafe = result && !result.claimAccepted && result.transaction.quote.totalPaise === result.actualQuote.totalPaise;

  return <main style={{ minHeight: "100vh", background: "#f7f7f3", color: "#171717", fontFamily: "Arial, sans-serif", padding: "34px 20px 70px" }}><div style={{ maxWidth: 1040, margin: "0 auto" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}><Link href="/" style={{ color: "#666", textDecoration: "none", fontSize: 13 }}>← Buyer workspace</Link><span style={{ border: "1px solid #c8d8ce", background: "#eff6f1", color: "#1e5b3e", padding: "7px 10px", fontSize: 11, fontWeight: 700 }}>JUDGE DEMO · AMOUNT INTEGRITY</span></div>
    <div style={{ borderTop: "2px solid #171717", paddingTop: 18 }}><div style={{ fontSize: 11, letterSpacing: ".12em", fontWeight: 700, color: "#777" }}>MANDATE / CLIENT TAMPER LAB</div><h1 style={{ fontSize: 50, letterSpacing: "-.05em", lineHeight: 1.02, margin: "10px 0 14px", maxWidth: 760 }}>A browser can lie about the price. The payment authority cannot trust it.</h1><p style={{ maxWidth: 760, color: "#666", lineHeight: 1.7, margin: 0 }}>This synthetic attack sends a deliberately false total alongside the purchase intent. The gateway ignores the claimed amount and re-reads the merchant quote before policy evaluation.</p></div>
    <section style={{ marginTop: 30, background: "white", border: "1px solid #dddcd7", padding: 22 }}><div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 14, alignItems: "stretch" }}><div style={{ border: "1px solid #dfc1bc", background: "#fbefed", padding: 18 }}><div style={{ fontSize: 10, color: "#8d332d", fontWeight: 700, letterSpacing: ".08em" }}>UNTRUSTED CLIENT CLAIM</div><strong style={{ display: "block", marginTop: 10, fontSize: 27 }}>10% of real price</strong><span style={{ display: "block", color: "#777", marginTop: 5 }}>Injected as claimedTotalPaise</span></div><div style={{ display: "grid", placeItems: "center", color: "#999", fontSize: 24 }}>→</div><div style={{ border: "1px solid #c5d6ca", background: "#eff6f1", padding: 18 }}><div style={{ fontSize: 10, color: "#1e5b3e", fontWeight: 700, letterSpacing: ".08em" }}>TRUSTED SERVER QUOTE</div><strong style={{ display: "block", marginTop: 10, fontSize: 27 }}>{result ? money(result.actualQuote.totalPaise) : "Fetched live"}</strong><span style={{ display: "block", color: "#777", marginTop: 5 }}>Merchant API is the source of truth</span></div></div><button disabled={loading} onClick={() => void runTamper()} style={{ marginTop: 18, border: 0, background: "#171717", color: "white", padding: "13px 16px", fontWeight: 700, cursor: "pointer" }}>{loading ? "Attacking the boundary…" : "Run price-tamper attack →"}</button></section>
    {error ? <div style={{ marginTop: 16, padding: 16, background: "#f6e9e7", border: "1px solid #dfc1bc", color: "#7b302b", fontSize: 13 }}>{error}</div> : null}
    {result ? <section style={{ marginTop: 18, background: "white", border: "1px solid #dddcd7" }}><div style={{ padding: 20, borderBottom: "1px solid #e8e7e2" }}><div style={{ fontSize: 11, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>ATTACK RESULT</div><h2 style={{ margin: "8px 0 6px", fontSize: 30 }}>{resultSafe ? "Tamper neutralized." : "Unexpected amount acceptance."}</h2><p style={{ color: "#666", lineHeight: 1.6, margin: 0 }}>{resultSafe ? "The gateway used the server-side merchant quote, not the browser's claimed total." : "The test did not produce the expected boundary result."}</p></div><div style={{ padding: 20, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>{[["CLIENT CLAIM", money(result.claimedTotalPaise)], ["MERCHANT QUOTE", money(result.actualQuote.totalPaise)], ["GATEWAY QUOTE", money(result.transaction.quote.totalPaise)]].map(([label, value]) => <div key={label} style={{ border: "1px solid #e5e5e1", padding: 14 }}><div style={{ fontSize: 9, color: "#777", letterSpacing: ".08em", fontWeight: 700 }}>{label}</div><strong style={{ display: "block", marginTop: 8, fontSize: 20 }}>{value}</strong></div>)}</div><div style={{ padding: 20, borderTop: "1px solid #e8e7e2" }}><div style={{ fontSize: 11, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>POLICY DECISION</div>{result.transaction.policy?.checks.map((check) => <div key={check.rule} style={{ display: "grid", gridTemplateColumns: "26px 1fr auto", gap: 8, alignItems: "center", padding: "9px 0", borderBottom: "1px solid #eeeeea" }}><span style={{ fontWeight: 700, color: check.result === "PASS" ? "#1e5b3e" : "#9b3a32" }}>{check.result === "PASS" ? "✓" : "×"}</span><strong style={{ fontSize: 12 }}>{check.rule.replaceAll("_", " ")}</strong><code style={{ fontSize: 10, color: "#777" }}>{check.observed}</code></div>)}</div><div style={{ padding: 20, background: "#fafaf7", borderTop: "1px solid #e8e7e2", fontSize: 12, color: "#666" }}><strong style={{ color: "#171717" }}>Invariant:</strong> the client never controls the amount used to authorize or create the Razorpay order.</div></section> : null}
  </div></main>;
}
