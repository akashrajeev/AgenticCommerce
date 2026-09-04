"use client";

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
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = result?.opportunities.find((item) => item.opportunityId === selectedId) ?? result?.opportunities[0];
  const agentOfferReady = agentRun?.state === "COMPLETED" && Boolean(agentRun.preparedOffer);

  async function discover() {
    setBusy(true); setMessage(""); setResult(null); setSelectedId(""); setAgentRun(null); setTransaction(null);
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
    setBusy(true); setMessage(""); setTransaction(null);
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
      if (body.preparedOffer) {
        setMessage(`Growth Agent prepared a fresh offer after ${body.trace?.length ?? 0} bounded tool step(s). Buyer approval is still required.`);
      } else {
        setMessage(`Growth Agent stopped in ${body.state} after ${body.plannerCalls ?? 0} planner call(s).`);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Growth Agent failed."); }
    finally { setBusy(false); }
  }

  async function approve() {
    if (!selected || !result) return;
    setBusy(true); setMessage("");
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
      if (!quoteResponse.ok) throw new Error(quoteBody.error ?? "Bundle quote failed.");
      const quote = quoteBody.quote;
      const response = await fetch(`${gateway}/v1/purchase-intents`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ merchantId: "mandate-market", productId: firstLine.productId, quantity: 1, lineItems, maxSpendPaise: Math.round(Number(budget) * 100), reason: agentOfferReady ? `Approved Growth Agent offer ${agentRun?.id}` : `Approved growth opportunity ${selected.opportunityId}`, quoteId: quote.quoteId }) });
      const body = await response.json();
      if (!response.ok || !body.transaction) throw new Error(body.error ?? "Gateway rejected the growth basket.");
      setTransaction(body.transaction as Transaction);
      setMessage(body.transaction.state === "policy_authorized" ? "Approved basket passed the same deterministic MANDATE gate as every other purchase." : "The gateway blocked the approved basket before payment.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Growth approval failed."); }
    finally { setBusy(false); }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}><div className={styles.brand}><span className={styles.mark}>M</span> MANDATE</div><div className={styles.links}><a href="/">Buyer</a><a href="/negotiation">Negotiation</a><a href="/delegated-mandates">Delegated</a></div></header>
      <section className={styles.grid}>
        <section className={styles.left}>
          <span className={styles.kicker}>PHASE 7 / AI GROWTH</span>
          <h1>Grow the basket without bypassing the gate.</h1>
          <p className={styles.lede}>The merchant exposes a measurable opportunity. The Growth Agent prepares a quote-backed offer. The buyer still decides whether it is relevant, and approval still routes through the same MANDATE boundary.</p>
          <div className={styles.flow}><span>RECOMMEND</span><b>→</b><span>AGENT</span><b>→</b><span>APPROVE</span><b>→</b><span>MANDATE</span></div>
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
            <div className={styles.opportunities}>{result.opportunities.map((opportunity) => <button key={opportunity.opportunityId} onClick={() => { setSelectedId(opportunity.opportunityId); setAgentRun(null); }} className={`${styles.opportunity} ${selected?.opportunityId === opportunity.opportunityId ? styles.selected : ""}`}><div><div className={styles.badgeRow}><span className={styles.badge}>{opportunity.type}</span><span className={styles.score}>score {opportunity.score}</span>{opportunity.budgetFit ? <span className={styles.fit}>budget fit</span> : <span className={styles.noFit}>over budget</span>}</div><strong>{opportunity.recommendedProductId}</strong><p>{opportunity.rationale}</p></div><div className={styles.value}><strong>+{money(opportunity.incrementalRevenue.amountPaise)}</strong><small>{money(opportunity.projectedBasket.amountPaise)} basket</small></div></button>)}</div>

            {agentRun && <div className={styles.source}><div><span>GROWTH AGENT</span><strong>{agentRun.state}</strong><small>{agentRun.plannerModel ?? "planner"} · {agentRun.plannerCalls} planner call(s) · {agentRun.id}</small></div>{agentRun.preparedOffer && <b>{money(agentRun.preparedOffer.bundleAmountPaise)}</b>}</div>}
            {agentRun && <div className={styles.opportunities}>{agentRun.trace.map((step) => <div key={`${agentRun.id}:${step.step}`} className={styles.source}><div><span>STEP {step.step}</span><strong>{step.tool}</strong><small>{step.status}{step.durationMs !== undefined ? ` · ${step.durationMs} ms` : ""}{step.error ? ` · ${step.error}` : ""}</small></div></div>)}</div>}

            {selected && <div className={styles.approval}><div><span className={styles.panelKicker}>{agentOfferReady ? "AGENT OFFER / APPROVAL" : "APPROVAL"}</span><h3>{agentOfferReady ? "Review the Growth Agent offer" : selected.type === "UPSELL" ? "Upgrade the product" : "Add a complementary item"}</h3><p>{agentOfferReady ? "The agent prepared this offer, but it cannot authorize payment. Approval below creates a fresh checkout quote before entering MANDATE." : selected.rationale}</p></div><div className={styles.approvalMeta}><span>Incremental value<strong>{money(agentRun?.preparedOffer?.incrementalRevenuePaise ?? selected.incrementalRevenue.amountPaise)}</strong></span><span>Projected basket<strong>{money(agentRun?.preparedOffer?.bundleAmountPaise ?? selected.projectedBasket.amountPaise)}</strong></span></div><button className={styles.approve} disabled={busy || !selected.budgetFit || (Boolean(agentRun) && !agentOfferReady)} onClick={() => void approve()}>{agentRun && !agentOfferReady ? "Agent offer not ready" : selected.budgetFit ? "Approve & route through MANDATE" : "Outside customer budget"}<span>→</span></button></div>}
            {transaction && <div className={`${styles.transaction} ${transaction.state === "policy_authorized" ? styles.allowed : styles.blocked}`}><div><span>GATEWAY DECISION</span><strong>{transaction.state === "policy_authorized" ? "ALLOWED" : "BLOCKED"}</strong><small>{transaction.id}</small></div><b>{money(transaction.quote.totalPaise)}</b></div>}
          </>}
        </section>
      </section>
    </main>
  );
}
