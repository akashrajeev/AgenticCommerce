"use client";

import Script from "next/script";
import { useState } from "react";
import styles from "./growth.module.css";

type Opportunity = {
  opportunityId: string;
  merchantId: string;
  sourceProductId: string;
  recommendedProductId: string;
  type: "UPSELL" | "CROSS_SELL";
  score: number;
  rationale: string;
  incrementalRevenue: { currency: "INR"; amountPaise: number };
  projectedBasket: { currency: "INR"; amountPaise: number };
  budgetFit: boolean;
  sourceQuoteId: string;
  bundleQuoteId: string;
  expiresAt: string;
};

type GrowthResponse = {
  sourceProduct: { id: string; name: string; pricePaise: number };
  opportunities: Opportunity[];
};

type AgentTraceStep = { step: number; tool: string; status: string; durationMs?: number; error?: string };
type AgentRun = {
  id: string;
  state: string;
  plannerCalls: number;
  plannerModel?: string;
  selectedOpportunity?: { sourceProductId?: string; targetProductId?: string; score?: number; incrementalRevenuePaise?: number };
  preparedOffer?: { lineItems: Array<{ productId: string; quantity: number }>; bundleAmountPaise: number; incrementalRevenuePaise: number; quoteId: string; expiresAt: string };
  trace: AgentTraceStep[];
};

type Transaction = { id: string; state: string; quote: { totalPaise: number } };
type CohortOrder = { transactionId: string; campaignId?: string; ok: boolean; body?: unknown; error?: string; order?: { id: string; amount: number; currency: string }; checkout?: { keyId: string; currency: "INR" } };

declare global { interface Window { Razorpay?: new (options: Record<string, unknown>) => { open: () => void } } }

const merchant = process.env.NEXT_PUBLIC_MERCHANT_URL ?? "http://localhost:3000";
const gateway = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4000";
const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(paise / 100);

export default function GrowthPage() {
  const [productId, setProductId] = useState("hp-001");
  const [budget, setBudget] = useState("10000");
  const [result, setResult] = useState<GrowthResponse | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [agentRun, setAgentRun] = useState<AgentRun | null>(null);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [cohortOrder, setCohortOrder] = useState<CohortOrder | null>(null);
  const [paymentStatus, setPaymentStatus] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = result?.opportunities.find((item) => item.opportunityId === selectedId) ?? result?.opportunities[0];
  const agentOfferReady = agentRun?.state === "COMPLETED" && Boolean(agentRun.preparedOffer);
  const cohortReady = Boolean(cohortOrder?.ok && cohortOrder.order && cohortOrder.checkout);

  async function discover() {
    setBusy(true); setMessage(""); setResult(null); setSelectedId(""); setAgentRun(null); setTransaction(null); setCohortOrder(null); setPaymentStatus("");
    try {
      const response = await fetch(`${merchant}/api/agent/growth-opportunities?productId=${encodeURIComponent(productId)}&maxSpendPaise=${Math.round(Number(budget) * 100)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to discover growth opportunities.");
      setResult(body as GrowthResponse);
      setSelectedId(body.opportunities?.[0]?.opportunityId ?? "");
      setMessage(`Merchant growth engine returned ${body.opportunities?.length ?? 0} eligible opportunities.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Growth discovery failed."); }
    finally { setBusy(false); }
  }

  async function prepareWithAgent() {
    if (!result) return;
    setBusy(true); setMessage(""); setTransaction(null); setCohortOrder(null); setPaymentStatus("");
    try {
      const response = await fetch(`${merchant}/api/agent/growth-agent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          campaignId: "headphone-aov",
          maxSpendPaise: Math.round(Number(budget) * 100),
          objective: `Increase basket value from ${result.sourceProduct.name} using the strongest eligible merchant growth opportunity, while staying within the customer budget and requiring explicit buyer approval.`,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Growth Agent failed to start.");
      setAgentRun(body as AgentRun);
      const matchedOpportunity = body.selectedOpportunity
        ? result.opportunities.find((item) => item.sourceProductId === body.selectedOpportunity.sourceProductId && item.recommendedProductId === body.selectedOpportunity.targetProductId)
        : undefined;
      if (matchedOpportunity) setSelectedId(matchedOpportunity.opportunityId);
      if (body.preparedOffer) setMessage(`Growth Agent prepared a fresh offer after ${body.trace?.length ?? 0} bounded tool step(s). Buyer approval is still required.`);
      else setMessage(`Growth Agent stopped in ${body.state} after ${body.plannerCalls ?? 0} planner call(s).`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Growth Agent failed."); }
    finally { setBusy(false); }
  }

  async function createTestModeOrder(transactionId: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${merchant}/api/campaign-orchestrator`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId: "headphone-aov", transactionIds: [transactionId] }),
        cache: "no-store",
      });
      const body = await response.json() as { results?: CohortOrder[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Test Mode order creation failed.");
      const first = body.results?.[0];
      if (!first) throw new Error("Test Mode order response was empty.");
      setCohortOrder(first);
      if (!first.ok) throw new Error(first.error ?? "Campaign Test Mode order creation was blocked.");
      setMessage("MANDATE-approved Growth Agent offer is now represented by a real Razorpay Test Mode order. Payment remains a separate checkout step.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Test Mode order creation failed."); }
    finally { setBusy(false); }
  }

  async function pollTransaction(transactionId: string) {
    const terminal = new Set(["order_confirmed", "payment_failed", "cancelled"]);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        const response = await fetch(`${gateway}/v1/transactions`, { cache: "no-store" });
        if (!response.ok) continue;
        const body = await response.json() as { transactions?: Array<{ id: string; state: string }> };
        const latest = body.transactions?.find((item) => item.id === transactionId);
        if (latest && terminal.has(latest.state)) return latest.state;
      } catch { /* bounded polling */ }
    }
    return null;
  }

  function openRazorpay() {
    if (!cohortOrder?.ok || !cohortOrder.order || !cohortOrder.checkout) return;
    if (!window.Razorpay) { setMessage("Razorpay Checkout is still loading."); return; }
    setPaymentStatus("CHECKOUT_OPEN");
    const instance = new window.Razorpay({
      key: cohortOrder.checkout.keyId,
      amount: cohortOrder.order.amount,
      currency: cohortOrder.checkout.currency,
      name: "Mandate Market",
      description: "Headphone AOV lift · Growth Agent Test Mode cohort",
      order_id: cohortOrder.order.id,
      handler: async (payment: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
        setPaymentStatus("VERIFYING_SIGNATURE");
        try {
          const response = await fetch(`${gateway}/v1/transactions/${encodeURIComponent(cohortOrder.transactionId)}/verify-payment`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payment), cache: "no-store" });
          const body = await response.json().catch(() => null) as { error?: string; verified?: boolean } | null;
          if (!response.ok) throw new Error(body?.error ?? "Payment verification failed.");
          setPaymentStatus(body?.verified ? "PAYMENT_VERIFIED" : "RECONCILING");
          const latest = await pollTransaction(cohortOrder.transactionId);
          setPaymentStatus(latest === "order_confirmed" ? "ORDER_CONFIRMED" : latest === "payment_failed" ? "PAYMENT_FAILED" : "RECONCILIATION_PENDING");
          if (latest === "order_confirmed") setMessage("Razorpay Test Mode payment is verified and the merchant order is confirmed. Open Growth Attribution to inspect the evidence-backed campaign uplift.");
        } catch (error) {
          setPaymentStatus("VERIFY_FAILED");
          setMessage(error instanceof Error ? error.message : "Payment verification failed.");
        }
      },
      modal: { ondismiss: () => setPaymentStatus("CHECKOUT_DISMISSED") },
    });
    instance.open();
  }

  async function approve() {
    if (!selected || !result) return;
    setBusy(true); setMessage(""); setCohortOrder(null); setPaymentStatus("");
    try {
      const agentLineItems = agentRun?.preparedOffer?.lineItems;
      const lineItems = agentLineItems?.length
        ? agentLineItems
        : selected.type === "UPSELL"
          ? [{ productId: selected.recommendedProductId, quantity: 1 }]
          : [{ productId: selected.sourceProductId, quantity: 1 }, { productId: selected.recommendedProductId, quantity: 1 }];
      const firstLine = lineItems[0];
      if (!firstLine) throw new Error("Growth basket is empty.");
      const quoteResponse = await fetch(`${merchant}/api/agent/checkout/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lineItems }) });
      const quoteBody = await quoteResponse.json();
      if (!quoteResponse.ok || !quoteBody.quote) throw new Error(quoteBody.error ?? "Bundle quote failed.");
      const quote = quoteBody.quote;
      const mandateResponse = await fetch("/api/growth-approval", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quote, maxSpendPaise: Math.round(Number(budget) * 100), reason: agentOfferReady ? `Approved Growth Agent offer ${agentRun?.id}` : `Approved growth opportunity ${selected.opportunityId}` }),
        cache: "no-store",
      });
      const body = await mandateResponse.json();
      if (!mandateResponse.ok || !body.transaction) throw new Error(body.error ?? "MANDATE rejected the growth basket.");
      const nextTransaction = body.transaction as Transaction & { state: string };
      setTransaction(nextTransaction);
      if (nextTransaction.state === "policy_authorized") {
        await createTestModeOrder(nextTransaction.id);
      } else {
        setMessage("MANDATE blocked the approved basket before payment.");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Growth approval failed."); }
    finally { setBusy(false); }
  }

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
      <main className={styles.shell}>
        <header className={styles.header}><div className={styles.brand}><span className={styles.mark}>M</span> MANDATE</div><div className={styles.links}><a href="/">Buyer</a><a href="/negotiation">Negotiation</a><a href="/delegated-mandates">Delegated</a></div></header>
        <section className={styles.grid}>
          <section className={styles.left}>
            <span className={styles.kicker}>PHASE 7 / AI GROWTH</span>
            <h1>Grow the basket without bypassing the gate.</h1>
            <p className={styles.lede}>The merchant exposes a measurable opportunity. The Growth Agent prepares a quote-backed offer. The buyer approves it explicitly. MANDATE verifies a signed human-present mandate, revalidates the basket, and only then allows a real Razorpay Test Mode order.</p>
            <div className={styles.flow}><span>RECOMMEND</span><b>→</b><span>AGENT</span><b>→</b><span>APPROVE</span><b>→</b><span>MANDATE</span><b>→</b><span>TEST MODE</span></div>
            <label className={styles.label}>Source product<input value={productId} onChange={(event) => setProductId(event.target.value)} placeholder="e.g. hp-001" /></label>
            <label className={styles.label}>Customer budget<input value={budget} onChange={(event) => setBudget(event.target.value)} inputMode="decimal" /></label>
            <button className={styles.primary} disabled={busy || !productId.trim()} onClick={() => void discover()}>{busy ? "Working…" : "Discover growth opportunities"}<span>→</span></button>
            {result && <button className={styles.primary} disabled={busy} onClick={() => void prepareWithAgent()}>{busy ? "Planning…" : "Ask Growth Agent to prepare an offer"}<span>→</span></button>}
            {message && <div className={styles.message}>{message}</div>}
          </section>
          <section className={styles.right}>
            <div className={styles.head}><div><span className={styles.panelKicker}>GROWTH OPPORTUNITIES</span><h2>{result ? result.sourceProduct.name : "Awaiting discovery"}</h2></div>{result && <span className={styles.count}>{result.opportunities.length} opportunities</span>}</div>
            {!result ? <div className={styles.empty}><span>↑</span><p>Run discovery to see upsell and cross-sell opportunities backed by the merchant catalog.</p></div> : <>
              <div className={styles.source}><span>BASE</span><strong>{result.sourceProduct.name}</strong><b>{money(result.sourceProduct.pricePaise)}</b></div>
              <div className={styles.opportunities}>{result.opportunities.map((opportunity) => <button key={opportunity.opportunityId} onClick={() => { setSelectedId(opportunity.opportunityId); setAgentRun(null); setCohortOrder(null); setPaymentStatus(""); }} className={`${styles.opportunity} ${selected?.opportunityId === opportunity.opportunityId ? styles.selected : ""}`}><div><div className={styles.badgeRow}><span className={styles.badge}>{opportunity.type}</span><span className={styles.score}>score {opportunity.score}</span>{opportunity.budgetFit ? <span className={styles.fit}>budget fit</span> : <span className={styles.noFit}>over budget</span>}</div><strong>{opportunity.recommendedProductId}</strong><p>{opportunity.rationale}</p></div><div className={styles.value}><strong>+{money(opportunity.incrementalRevenue.amountPaise)}</strong><small>{money(opportunity.projectedBasket.amountPaise)} basket</small></div></button>)}</div>

              {agentRun && <div className={styles.source}><div><span>GROWTH AGENT</span><strong>{agentRun.state}</strong><small>{agentRun.plannerModel ?? "planner"} · {agentRun.plannerCalls} planner call(s) · {agentRun.id}</small></div>{agentRun.preparedOffer && <b>{money(agentRun.preparedOffer.bundleAmountPaise)}</b>}</div>}
              {agentRun && <div className={styles.opportunities}>{agentRun.trace.map((step) => <div key={`${agentRun.id}:${step.step}`} className={styles.source}><div><span>STEP {step.step}</span><strong>{step.tool}</strong><small>{step.status}{step.durationMs !== undefined ? ` · ${step.durationMs} ms` : ""}{step.error ? ` · ${step.error}` : ""}</small></div></div>)}</div>}

              {selected && <div className={styles.approval}><div><span className={styles.panelKicker}>{agentOfferReady ? "AGENT OFFER / APPROVAL" : "APPROVAL"}</span><h3>{agentOfferReady ? "Review the Growth Agent offer" : selected.type === "UPSELL" ? "Upgrade the product" : "Add a complementary item"}</h3><p>{agentOfferReady ? "The agent prepared this offer, but it cannot authorize payment. Your approval creates a fresh quote, signs a human-present mandate at the buyer boundary, enters MANDATE, and then can create a real attributable Test Mode order." : selected.rationale}</p></div><div className={styles.approvalMeta}><span>Incremental value<strong>{money(agentRun?.preparedOffer?.incrementalRevenuePaise ?? selected.incrementalRevenue.amountPaise)}</strong></span><span>Projected basket<strong>{money(agentRun?.preparedOffer?.bundleAmountPaise ?? selected.projectedBasket.amountPaise)}</strong></span></div><button className={styles.approve} disabled={busy || !selected.budgetFit || (Boolean(agentRun) && !agentOfferReady)} onClick={() => void approve()}>{agentRun && !agentOfferReady ? "Agent offer not ready" : selected.budgetFit ? "Approve & route through MANDATE" : "Outside customer budget"}<span>→</span></button></div>}

              {transaction && <div className={`${styles.transaction} ${transaction.state === "policy_authorized" ? styles.allowed : styles.blocked}`}><div><span>MANDATE DECISION</span><strong>{transaction.state === "policy_authorized" ? "ALLOWED" : "BLOCKED"}</strong><small>{transaction.id}</small></div><b>{money(transaction.quote.totalPaise)}</b></div>}
              {cohortOrder && <div className={styles.transaction}><div><span>TEST MODE COHORT</span><strong>{cohortReady ? "ORDER CREATED" : "BLOCKED"}</strong><small>{cohortOrder.order?.id ?? cohortOrder.error ?? "No Razorpay order"}</small></div>{cohortReady ? <button className={styles.approve} disabled={paymentStatus === "CHECKOUT_OPEN" || paymentStatus === "ORDER_CONFIRMED"} onClick={() => openRazorpay()}>{paymentStatus === "ORDER_CONFIRMED" ? "Payment confirmed" : paymentStatus ? paymentStatus.replaceAll("_", " ") : "Pay in Razorpay Test Mode →"}</button> : <b>NO ORDER</b>}</div>}
              {paymentStatus === "ORDER_CONFIRMED" && <div className={styles.message}><a href="/growth-attribution">Open evidence-backed campaign attribution →</a></div>}
            </>}
          </section>
        </section>
      </main>
    </>
  );
}
