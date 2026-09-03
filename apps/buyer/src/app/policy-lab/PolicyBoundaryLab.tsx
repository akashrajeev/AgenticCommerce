"use client";

import Link from "next/link";
import { useState } from "react";

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4000";
const basket = [
  { id: "hp-001", name: "SoundMax Pro", pricePaise: 399900 },
  { id: "ms-001", name: "Arc Precision Mouse", pricePaise: 249900 },
] as const;
const primaryProduct = basket[0];

function money(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
}

type Check = { rule: string; result: "PASS" | "FAIL"; observed: string; expected: string; reason: string };
type Transaction = { id: string; state: string; razorpayOrderId?: string; quote: { totalPaise: number }; policy?: { decision: "ALLOW" | "BLOCK"; checks: Check[] } };
type LabResult = { scenario: "BLOCKED" | "RECOVERY_AUTHORIZED"; quote: { totalPaise: number; lineItems: Array<{ productId: string; quantity: number; lineTotalPaise: number }> }; transaction: Transaction };
type OrderResult = { transaction?: Transaction; order?: { id: string; amount: number; currency: string }; error?: string };
type TimelineEvent = { id: string; actor: string; action: string; reason: string; createdAt: string };

export default function PolicyBoundaryLab() {
  const [result, setResult] = useState<LabResult | null>(null);
  const [blockedResult, setBlockedResult] = useState<LabResult | null>(null);
  const [timelines, setTimelines] = useState<Record<string, TimelineEvent[]>>({});
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState<OrderResult | null>(null);
  const [error, setError] = useState("");

  async function loadTimeline(transactionId: string) {
    try {
      const response = await fetch(`${GATEWAY_URL}/v1/transactions/${transactionId}/timeline`, { cache: "no-store" });
      const body = await response.json().catch(() => null) as { events?: TimelineEvent[] } | null;
      if (response.ok && Array.isArray(body?.events)) {
        setTimelines((current) => ({ ...current, [transactionId]: body.events! }));
      }
    } catch {
      // Timeline evidence is additive; the transaction result remains authoritative.
    }
  }

  async function run(limitPaise: number) {
    setLoading(true); setError(""); setOrder(null);
    try {
      const response = await fetch("/api/policy-lab", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxSpendPaise: limitPaise }) });
      const body = await response.json().catch(() => null) as LabResult & { error?: string };
      if (!response.ok) throw new Error(body?.error ?? "Policy lab request failed.");
      setResult(body);
      if (body.scenario === "BLOCKED") setBlockedResult(body);
      await loadTimeline(body.transaction.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Policy lab request failed.");
    } finally { setLoading(false); }
  }

  async function createTestOrder() {
    if (!result || result.transaction.state !== "policy_authorized") return;
    setLoading(true); setError("");
    try {
      const response = await fetch(`${GATEWAY_URL}/v1/transactions/${result.transaction.id}/razorpay-order`, { method: "POST" });
      const body = await response.json().catch(() => null) as OrderResult;
      if (!response.ok) throw new Error(body?.error ?? "Unable to create Razorpay order.");
      setOrder(body);
      if (body.transaction) {
        setResult((current) => current ? { ...current, transaction: body.transaction! } : current);
        await loadTimeline(body.transaction.id);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create Razorpay order.");
    } finally { setLoading(false); }
  }

  const quoteTotal = result?.quote.totalPaise ?? 0;
  const uplift = Math.max(quoteTotal - primaryProduct.pricePaise, 0);
  const blocked = result?.scenario === "BLOCKED";
  const limit = blocked ? 500000 : 800000;
  const recoveryProofReady = Boolean(result && result.scenario === "RECOVERY_AUTHORIZED" && blockedResult);
  const blockedTimeline = blockedResult ? timelines[blockedResult.transaction.id] ?? [] : [];
  const recoveryTimeline = result ? timelines[result.transaction.id] ?? [] : [];

  return (
    <main style={{ minHeight: "100vh", background: "#f7f7f3", color: "#171717", fontFamily: "Arial, sans-serif", padding: "34px 20px 70px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "center", marginBottom: 28 }}>
          <Link href="/" style={{ color: "#555", textDecoration: "none", fontSize: 13 }}>← Buyer workspace</Link>
          <span style={{ border: "1px solid #c8d8ce", background: "#eff6f1", color: "#1e5b3e", padding: "7px 10px", fontSize: 11, fontWeight: 700 }}>JUDGE DEMO · POLICY BOUNDARY</span>
        </div>
        <div style={{ borderTop: "2px solid #171717", paddingTop: 18 }}>
          <div style={{ fontSize: 11, letterSpacing: ".12em", fontWeight: 700, color: "#777" }}>MANDATE / FAILURE & RECOVERY LAB</div>
          <h1 style={{ fontSize: 52, letterSpacing: "-.05em", lineHeight: 1.02, margin: "10px 0 14px", maxWidth: 760 }}>Show the financial boundary in under 30 seconds.</h1>
          <p style={{ maxWidth: 760, color: "#666", lineHeight: 1.7, margin: 0 }}>This lab uses the live merchant quote and the same gateway policy engine used by the buyer checkout. No simulated policy result and no payment is created until the authorized path explicitly asks for one.</p>
        </div>

        <section style={{ marginTop: 34, display: "grid", gridTemplateColumns: "1.15fr .85fr", gap: 14 }}>
          <div style={{ background: "white", border: "1px solid #dddcd7", padding: 22 }}>
            <div style={{ fontSize: 11, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>BASKET UNDER TEST</div>
            <div style={{ marginTop: 16 }}>{basket.map((item) => <div key={item.id} style={{ display: "flex", justifyContent: "space-between", padding: "15px 0", borderBottom: "1px solid #e8e7e2" }}><span><strong>{item.name}</strong><small style={{ display: "block", color: "#777", marginTop: 4 }}>{item.id} · quantity 1</small></span><strong>{money(item.pricePaise)}</strong></div>)}</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, fontSize: 14 }}><span>Fresh merchant checkout quote</span><strong>{result ? money(quoteTotal) : "—"}</strong></div>
            <div style={{ color: "#777", fontSize: 12, marginTop: 7 }}>A fresh server quote is fetched for every scenario.</div>
          </div>
          <div style={{ background: "#171717", color: "white", padding: 22 }}>
            <div style={{ fontSize: 11, color: "#bcbcb8", letterSpacing: ".1em", fontWeight: 700 }}>SECURITY PROPERTY</div>
            <div style={{ fontSize: 28, lineHeight: 1.15, marginTop: 14, letterSpacing: "-.03em" }}>AI can recommend the basket. It cannot move the hard limit.</div>
            <div style={{ marginTop: 18, fontSize: 12, lineHeight: 1.7, color: "#c9c9c5" }}>The gateway re-reads merchant price and inventory, evaluates the complete basket, and only an ALLOW decision can create a Razorpay order.</div>
          </div>
        </section>

        <section style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <button disabled={loading} onClick={() => void run(500000)} style={{ textAlign: "left", border: "1px solid #d9c0bb", background: "#fbefed", padding: 22, cursor: "pointer" }}>
            <div style={{ fontSize: 11, color: "#8d332d", letterSpacing: ".1em", fontWeight: 700 }}>SCENARIO A</div>
            <div style={{ fontSize: 25, marginTop: 8, fontWeight: 700 }}>Hard limit ₹5,000</div>
            <div style={{ marginTop: 8, color: "#6f5a57", fontSize: 12 }}>Run the real policy engine. Expected outcome: blocked before Razorpay.</div>
          </button>
          <button disabled={loading} onClick={() => void run(800000)} style={{ textAlign: "left", border: "1px solid #c5d6ca", background: "#eff6f1", padding: 22, cursor: "pointer" }}>
            <div style={{ fontSize: 11, color: "#1e5b3e", letterSpacing: ".1em", fontWeight: 700 }}>SCENARIO B · RECOVERY</div>
            <div style={{ fontSize: 25, marginTop: 8, fontWeight: 700 }}>Raise limit to ₹8,000</div>
            <div style={{ marginTop: 8, color: "#5a6b62", fontSize: 12 }}>Run the same basket again. Expected outcome: authorized, then optionally create a Test Mode order.</div>
          </button>
        </section>

        {loading ? <div style={{ marginTop: 18, padding: 16, border: "1px solid #dddcd7", background: "white", fontSize: 13 }}>Running merchant quote → gateway revalidation → policy evaluation…</div> : null}
        {error ? <div style={{ marginTop: 18, padding: 16, border: "1px solid #dfc1bc", background: "#f6e9e7", color: "#7b302b", fontSize: 13 }}>{error}</div> : null}

        {result ? <section style={{ marginTop: 18, background: "white", border: "1px solid #dddcd7" }}>
          <div style={{ padding: 20, borderBottom: "1px solid #e8e7e2", display: "flex", justifyContent: "space-between", gap: 20, alignItems: "start" }}>
            <div><div style={{ fontSize: 11, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>{blocked ? "POLICY GATE" : "RECOVERY PATH"}</div><h2 style={{ margin: "8px 0 6px", fontSize: 29, letterSpacing: "-.03em" }}>{blocked ? "Purchase stopped before Razorpay" : "Basket authorized for payment"}</h2><div style={{ color: "#666", fontSize: 12 }}>{result.transaction.id}</div></div>
            <div style={{ fontSize: 13, fontWeight: 700, padding: "8px 10px", background: blocked ? "#f7e7e4" : "#eaf4ed", color: blocked ? "#8d332d" : "#1e5b3e" }}>{result.transaction.state.replaceAll("_", " ")}</div>
          </div>
          <div style={{ padding: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div><div style={{ fontSize: 11, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>QUOTE VS LIMIT</div><div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}><span>Final basket</span><strong>{money(quoteTotal)}</strong></div><div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}><span>Hard limit</span><strong>{money(limit)}</strong></div><div style={{ height: 8, background: "#ededeb", marginTop: 12, overflow: "hidden" }}><div style={{ width: `${Math.min((quoteTotal / limit) * 100, 100)}%`, height: "100%", background: blocked ? "#a64c44" : "#3f7e5d" }} /></div><div style={{ color: "#777", marginTop: 10, fontSize: 12 }}>{blocked ? `${money(Math.max(quoteTotal - limit, 0))} over the limit` : `${money(Math.max(limit - quoteTotal, 0))} remaining`}</div></div>
            <div><div style={{ fontSize: 11, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>POLICY CHECKS</div><div style={{ marginTop: 12 }}>{result.transaction.policy?.checks.map((check) => <div key={check.rule} style={{ display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 8, alignItems: "center", padding: "9px 0", borderBottom: "1px solid #eeeeea" }}><span style={{ fontWeight: 700, color: check.result === "PASS" ? "#1e5b3e" : "#9b3a32" }}>{check.result === "PASS" ? "✓" : "×"}</span><span style={{ fontSize: 12, fontWeight: 700 }}>{check.rule.replaceAll("_", " ")}</span><code style={{ fontSize: 10, color: "#777" }}>{check.observed}</code></div>)}</div></div>
          </div>
          <div style={{ padding: 20, borderTop: "1px solid #e8e7e2", background: "#fafaf7", display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center" }}>
            <div><strong>{blocked ? "NO RAZORPAY ORDER CREATED" : order?.order?.id ? "RAZORPAY TEST ORDER CREATED" : "POLICY PASSED · PAYMENT NOT STARTED"}</strong><div style={{ color: "#777", fontSize: 12, marginTop: 5 }}>{blocked ? "The failed authorization ends before the payment rail." : order?.order?.id ? `${order.order.id} · ${money(order.order.amount)}` : "The authorized transaction is ready for the next payment step."}</div></div>
            {!blocked && !order?.order?.id ? <button disabled={loading} onClick={() => void createTestOrder()} style={{ border: 0, background: "#171717", color: "white", padding: "12px 15px", cursor: "pointer", fontWeight: 700 }}>Create Razorpay Test Order →</button> : null}
          </div>
        </section> : null}

        {recoveryProofReady && blockedResult ? <section style={{ marginTop: 18, border: "1px solid #cfd9d1", background: "#f4f7f4" }}>
          <div style={{ padding: 20, borderBottom: "1px solid #dce4de" }}>
            <div style={{ fontSize: 11, color: "#1e5b3e", letterSpacing: ".1em", fontWeight: 700 }}>RECOVERY EVIDENCE</div>
            <h2 style={{ margin: "8px 0 6px", fontSize: 27, letterSpacing: "-.03em" }}>The blocked attempt stayed in history.</h2>
            <div style={{ color: "#657068", fontSize: 12 }}>Two distinct transactions prove the boundary was enforced first and the higher limit was applied only to a fresh authorization attempt.</div>
          </div>
          <div style={{ padding: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div style={{ background: "white", border: "1px solid #e1cfca", padding: 18 }}>
              <div style={{ fontSize: 11, color: "#9b3a32", letterSpacing: ".08em", fontWeight: 700 }}>ATTEMPT A · BLOCKED</div>
              <div style={{ marginTop: 10, fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}>{blockedResult.transaction.id}</div>
              <div style={{ marginTop: 12, fontWeight: 700 }}>₹5,000 hard limit · blocked before Razorpay</div>
              <div style={{ marginTop: 14 }}>{blockedTimeline.slice(-4).map((event) => <div key={event.id} style={{ borderTop: "1px solid #eee7e4", padding: "9px 0" }}><strong style={{ fontSize: 11 }}>{event.action.replaceAll("_", " ")}</strong><div style={{ color: "#777", fontSize: 11, marginTop: 3 }}>{event.reason}</div></div>)}{blockedTimeline.length === 0 ? <div style={{ color: "#777", fontSize: 11, marginTop: 12 }}>Timeline is still loading; the transaction record above is the authoritative result.</div> : null}</div>
            </div>
            <div style={{ background: "white", border: "1px solid #c9dacd", padding: 18 }}>
              <div style={{ fontSize: 11, color: "#1e5b3e", letterSpacing: ".08em", fontWeight: 700 }}>ATTEMPT B · RECOVERY</div>
              <div style={{ marginTop: 10, fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}>{result?.transaction.id}</div>
              <div style={{ marginTop: 12, fontWeight: 700 }}>₹8,000 hard limit · authorized</div>
              <div style={{ marginTop: 14 }}>{recoveryTimeline.slice(-4).map((event) => <div key={event.id} style={{ borderTop: "1px solid #e9eee9", padding: "9px 0" }}><strong style={{ fontSize: 11 }}>{event.action.replaceAll("_", " ")}</strong><div style={{ color: "#777", fontSize: 11, marginTop: 3 }}>{event.reason}</div></div>)}{recoveryTimeline.length === 0 ? <div style={{ color: "#777", fontSize: 11, marginTop: 12 }}>Timeline is still loading; the transaction result above is the authoritative outcome.</div> : null}</div>
            </div>
          </div>
        </section> : null}

        <div style={{ marginTop: 28, borderTop: "1px solid #d9d8d2", paddingTop: 18, color: "#777", fontSize: 11, lineHeight: 1.7 }}>Demonstrated basket uplift potential: {money(uplift)} above the primary product. This number is informational; policy always evaluates the complete quoted basket.</div>
      </div>
    </main>
  );
}
