"use client";

import { useEffect, useMemo, useState } from "react";

const gateway = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4000";
const merchant = process.env.NEXT_PUBLIC_MERCHANT_URL ?? "http://localhost:3000";

type Mandate = {
  mandateId: string;
  purpose: string;
  merchantIds: string[];
  allowedProductIds?: string[];
  maxSpendPerPurchase: { currency: "INR"; amountPaise: number };
  totalBudget: { currency: "INR"; amountPaise: number };
  spentPaise: number;
  reservedPaise: number;
  remainingPaise: number;
  remainingDisplay: string;
  executionCount: number;
  blockedCount: number;
  status: string;
  expiresAt: string;
};

type Quote = {
  quoteId: string;
  merchantId: string;
  lineItems: { productId: string; quantity: number; unitPricePaise: number; lineTotalPaise: number }[];
  totalPaise: number;
  currency: "INR";
  expiresAt: string;
};

async function hashBinding(value: { checkoutId: string; merchantId: string; quoteId: string; currency: "INR"; totalPaise: number; lineItems: Quote["lineItems"]; expiresAt: string }) {
  const ordered = [...value.lineItems].sort((a, b) => a.productId.localeCompare(b.productId));
  const canonical = JSON.stringify({ ...value, lineItems: ordered });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default function DelegatedMandatesPage() {
  const [mandates, setMandates] = useState<Mandate[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [subjectId, setSubjectId] = useState("user_001");
  const [agentId, setAgentId] = useState("buyer_001");
  const [purpose, setPurpose] = useState("Buy approved office electronics");
  const [perPurchase, setPerPurchase] = useState("5000");
  const [budget, setBudget] = useState("10000");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [lastDecision, setLastDecision] = useState<null | { allowed: boolean; amount: number; code?: string; transactionId?: string }>(null);

  const selected = useMemo(() => mandates.find((item) => item.mandateId === selectedId) ?? mandates[0], [mandates, selectedId]);

  async function load() {
    const response = await fetch(`${gateway}/v1/delegated-mandates`, { cache: "no-store" });
    const body = await response.json();
    const next = Array.isArray(body.mandates) ? body.mandates.filter(Boolean) : [];
    setMandates(next);
    if (!selectedId && next[0]?.mandateId) setSelectedId(next[0].mandateId);
  }

  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load mandates.")); }, []);

  async function create() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${gateway}/v1/delegated-mandates`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subjectId, agentId, purpose, merchantIds: ["mandate-market"], allowedProductIds: ["hp-001"], maxSpendPerPurchase: { currency: "INR", amountPaise: Math.round(Number(perPurchase) * 100) }, totalBudget: { currency: "INR", amountPaise: Math.round(Number(budget) * 100) }, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Mandate creation failed.");
      setSelectedId(body.mandate.mandateId);
      await load();
      setMessage("Delegated authority issued. No per-purchase approval is needed inside these bounds.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Mandate creation failed."); }
    finally { setBusy(false); }
  }

  async function execute(quantity: number) {
    if (!selected) return;
    setBusy(true); setMessage(""); setLastDecision(null);
    try {
      const previewResponse = await fetch(`${merchant}/api/agent/checkout/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lineItems: [{ productId: "hp-001", quantity }] }) });
      const preview = await previewResponse.json();
      if (!previewResponse.ok) throw new Error(preview.error ?? "Quote preview failed.");
      const quote: Quote = preview.quote;
      const checkoutId = `delegated_demo_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
      const checkoutBase = { checkoutId, merchantId: quote.merchantId, quoteId: quote.quoteId, currency: quote.currency, totalPaise: quote.totalPaise, lineItems: quote.lineItems, expiresAt: quote.expiresAt };
      const cartHash = await hashBinding(checkoutBase);
      const response = await fetch(`${gateway}/v1/delegated-mandates/${encodeURIComponent(selected.mandateId)}/execute`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ checkout: { ...checkoutBase, cartHash } }) });
      const body = await response.json();
      if (!response.ok) {
        setLastDecision({ allowed: false, amount: quote.totalPaise, code: body.error });
        throw new Error(body.error ?? "Delegated execution blocked.");
      }
      setLastDecision({ allowed: true, amount: quote.totalPaise, transactionId: body.transaction?.id });
      await load();
      setMessage(body.payment?.order?.id ? `Authorized and created Razorpay order ${body.payment.order.id}.` : "Authorized and bound to a trusted transaction. Configure Razorpay Test Mode credentials to create the external order.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Delegated execution failed."); }
    finally { setBusy(false); }
  }

  async function revoke() {
    if (!selected) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${gateway}/v1/delegated-mandates/${encodeURIComponent(selected.mandateId)}/revoke`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Revoke failed.");
      await load();
      setMessage("Delegated authority revoked. Further autonomous executions are blocked.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Revoke failed."); }
    finally { setBusy(false); }
  }

  return (
    <main className="delegated-shell">
      <header className="delegated-header"><div className="brand"><span className="brand-mark">M</span> MANDATE</div><a href="/">Buyer workspace</a></header>
      <section className="delegated-grid">
        <div className="delegated-copy">
          <span className="section-kicker">Phase 5 / delegated authority</span>
          <h1>Let the agent buy inside a hard boundary.</h1>
          <p>One user-approved mandate defines the ceiling. Every autonomous purchase is still re-quoted, policy-checked, cryptographically bound, and auditable by the gateway.</p>
          <div className="delegated-flow"><span>MANDATE</span><b>→</b><span>QUOTE</span><b>→</b><span>POLICY</span><b>→</b><span>RAZORPAY</span></div>
          <div className="delegated-form">
            <label>Purpose<input value={purpose} onChange={(event) => setPurpose(event.target.value)} /></label>
            <div className="delegated-two"><label>Per-purchase max<input value={perPurchase} onChange={(event) => setPerPurchase(event.target.value)} inputMode="decimal" /></label><label>Total budget<input value={budget} onChange={(event) => setBudget(event.target.value)} inputMode="decimal" /></label></div>
            <div className="delegated-two"><label>Subject<input value={subjectId} onChange={(event) => setSubjectId(event.target.value)} /></label><label>Agent<input value={agentId} onChange={(event) => setAgentId(event.target.value)} /></label></div>
            <button className="delegated-primary" disabled={busy} onClick={create}>{busy ? "Working…" : "Issue delegated mandate"}<span>→</span></button>
          </div>
        </div>

        <div className="delegated-panel">
          <div className="delegated-panel-head"><div><span className="panel-kicker">Active authority</span><h2>{selected ? selected.purpose : "No delegated mandate yet"}</h2></div><button className="quiet-button" onClick={() => void load()}>Refresh</button></div>
          {selected ? <>
            <div className="mandate-metrics"><div><span>Remaining</span><strong>{selected.remainingDisplay}</strong></div><div><span>Reserved</span><strong>₹{(selected.reservedPaise / 100).toFixed(2)}</strong></div><div><span>Executions</span><strong>{selected.executionCount}</strong></div><div><span>Blocked</span><strong>{selected.blockedCount}</strong></div></div>
            <div className="mandate-meta"><span className={`mandate-status ${selected.status}`}>{selected.status}</span><code>{selected.mandateId}</code><span>Expires {new Date(selected.expiresAt).toLocaleString()}</span></div>
            <div className="boundary-card"><span>BOUNDARY</span><strong>₹{(selected.maxSpendPerPurchase.amountPaise / 100).toFixed(2)} per purchase</strong><p>Merchant: {selected.merchantIds.join(", ") || "any"} · Product: {selected.allowedProductIds?.join(", ") || "any"}</p></div>
            <div className="delegated-actions"><button disabled={busy || selected.status !== "active"} onClick={() => void execute(1)}>Run qualifying purchase<span>1 × approved product</span></button><button disabled={busy || selected.status !== "active"} onClick={() => void execute(2)}>Test outside boundary<span>2 × approved product</span></button></div>
            <button className="revoke-button" disabled={busy || selected.status !== "active"} onClick={() => void revoke()}>Revoke delegated authority</button>
            {lastDecision && <div className={`execution-result ${lastDecision.allowed ? "allowed" : "blocked"}`}><strong>{lastDecision.allowed ? "ALLOWED" : "BLOCKED"}</strong><span>₹{(lastDecision.amount / 100).toFixed(2)}</span><code>{lastDecision.transactionId ?? lastDecision.code}</code></div>}
          </> : <div className="delegated-empty">Create a mandate to unlock bounded autonomous execution.</div>}
          {message && <div className="delegated-message">{message}</div>}
        </div>
      </section>
    </main>
  );
}
