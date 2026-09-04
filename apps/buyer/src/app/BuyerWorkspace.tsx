"use client";

import Script from "next/script";
import { useMemo, useState } from "react";

const MERCHANT_URL = process.env.NEXT_PUBLIC_MERCHANT_URL ?? "http://localhost:3000";
const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4000";
const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);

type Product = {
  id: string;
  name: string;
  category: string;
  pricePaise: number;
  rating: number;
  inventory: number;
  shortDescription?: string;
  features: string[];
  specifications: Record<string, string>;
};

type Quote = {
  quoteId: string;
  merchantId: string;
  totalPaise: number;
  subtotalPaise: number;
  shippingPaise: number;
  taxPaise: number;
  discountPaise: number;
  expiresAt: string;
  currency: "INR";
  lineItems: Array<{ productId: string; quantity: number; unitPricePaise: number; lineTotalPaise: number }>;
};

type BasketLine = { productId: string; quantity: number };
type Recommendation = { productId: string; type: "UPSELL" | "CROSS_SELL"; score: number; rationale: string; incrementalRevenuePaise: number };
type TraceStep = { step: number; state: string; tool: string; status: "started" | "succeeded" | "failed"; reason?: string; error?: string; output?: unknown; plannerModel?: string; durationMs?: number };
type AgentRun = { id: string; objective: string; state: string; stepCount: number; constraints: { maxSpendPaise: number; currency: "INR"; maxSteps: number }; plannerCalls?: number; plannerModel?: string; lastError?: string };
type AgentWorkspace = { manifest?: { merchantId: string; name: string; version: string }; catalog?: Product[]; inspectedProducts: Record<string, Product>; inventory: Record<string, number>; recommendations: Recommendation[]; selectedProductId?: string; basket: BasketLine[]; latestQuote?: Quote };
type AgentResponse = { run: AgentRun; workspace: AgentWorkspace; trace: TraceStep[]; plannerCalls: number; plannerModel?: string };
type Transaction = { id: string; state: string; razorpayOrderId?: string; razorpayPaymentId?: string; intent: { productId: string; quantity: number; maxSpendPaise: number; reason: string; lineItems?: BasketLine[] }; quote: Quote; policy?: { decision: "ALLOW" | "BLOCK"; checks: Array<{ rule: string; result: "PASS" | "FAIL"; observed: string; expected: string; reason: string }> }; mandateAuthorization?: { authorizationId?: string; status?: string } };
type RazorpayCheckout = { keyId: string; currency: "INR"; order: { id: string; amount: number; currency: string } };

export default function BuyerWorkspace() {
  const [request, setRequest] = useState("Buy the best ANC headphones under ₹5,000 and add something useful only if it helps.");
  const [maxSpend, setMaxSpend] = useState(5000);
  const [agentRun, setAgentRun] = useState<AgentRun | null>(null);
  const [agentWorkspace, setAgentWorkspace] = useState<AgentWorkspace | null>(null);
  const [agentTrace, setAgentTrace] = useState<TraceStep[]>([]);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [approvedBasket, setApprovedBasket] = useState<BasketLine[]>([]);
  const [stage, setStage] = useState("ready");
  const [error, setError] = useState("");
  const [activity, setActivity] = useState<string[]>([]);
  const [checkout, setCheckout] = useState<RazorpayCheckout | null>(null);

  const product = useMemo(() => {
    const id = agentWorkspace?.selectedProductId;
    if (!id) return null;
    return agentWorkspace.inspectedProducts[id] ?? agentWorkspace.catalog?.find((item) => item.id === id) ?? null;
  }, [agentWorkspace]);

  const basket = approvedBasket.length ? approvedBasket : agentWorkspace?.basket ?? (product ? [{ productId: product.id, quantity: 1 }] : []);
  const selectedAmount = transaction?.quote.totalPaise ?? agentWorkspace?.latestQuote?.totalPaise ?? product?.pricePaise ?? 0;
  const remaining = Math.max(maxSpend * 100 - selectedAmount, 0);
  const blockedBySpend = transaction?.state === "policy_blocked" && transaction.policy?.checks.some((check) => check.rule === "MAX_SPEND" && check.result === "FAIL");
  const paymentFailed = transaction?.state === "payment_failed";
  const readyForApproval = agentRun?.state === "WAITING_FOR_APPROVAL" && !transaction;
  const statusLabel = useMemo(() => {
    if (stage === "blocked") return "Blocked before payment";
    if (stage === "authorized") return "Authorized";
    if (stage === "working") return "Agent working";
    if (stage === "payment") return "Payment ready";
    if (stage === "paid") return "Verified";
    if (readyForApproval) return "Ready for approval";
    return paymentFailed ? "Payment failed" : "Ready";
  }, [stage, paymentFailed, readyForApproval]);

  async function runAgent() {
    setError("");
    setTransaction(null);
    setApprovedBasket([]);
    setCheckout(null);
    setAgentRun(null);
    setAgentWorkspace(null);
    setAgentTrace([]);
    setActivity(["Reading immutable buyer constraints", "Starting model-directed buyer agent"]);
    setStage("working");
    try {
      const response = await fetch("/api/agent/buyer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objective: request, maxSpendPaise: maxSpend * 100, maxSteps: 12 }),
      });
      const body = await response.json() as AgentResponse & { error?: string };
      if (!response.ok || !body.run || !body.workspace) throw new Error(body.error ?? "The buyer agent could not complete the task.");
      setAgentRun(body.run);
      setAgentWorkspace(body.workspace);
      setAgentTrace(body.trace ?? []);
      setActivity((current) => [
        ...current,
        `${body.trace?.length ?? 0} bounded agent steps executed`,
        body.workspace.selectedProductId ? `Selected ${body.workspace.selectedProductId}` : "No product selected",
        body.workspace.basket.length ? `Basket prepared with ${body.workspace.basket.length} line(s)` : "No basket prepared",
        body.run.state === "WAITING_FOR_APPROVAL" ? "Buyer recommendation is ready for explicit approval" : `Agent ended in ${body.run.state}`,
      ]);
      setStage(body.run.state === "WAITING_FOR_APPROVAL" ? "ready" : body.run.state === "FAILED" ? "ready" : "working");
    } catch (caught) {
      setStage("ready");
      setError(caught instanceof Error ? caught.message : "The buyer agent could not complete the request.");
    }
  }

  async function approveBasket() {
    if (!agentWorkspace || !product) return;
    const lines = agentWorkspace.basket.length ? agentWorkspace.basket : [{ productId: product.id, quantity: 1 }];
    const firstLine = lines[0];
    if (!firstLine) {
      setError("The proposed basket is empty.");
      return;
    }
    setError("");
    setApprovedBasket(lines);
    setStage("working");
    setActivity((current) => [...current, "User approved the buyer agent's proposed basket", "Requesting a fresh merchant quote", "Minting signed human-present MANDATE authorization"]);
    try {
      const quoteResponse = await fetch(`${MERCHANT_URL}/api/agent/checkout/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineItems: lines }),
      });
      const quoteBody = await quoteResponse.json() as { quote?: Quote; error?: string };
      if (!quoteResponse.ok || !quoteBody.quote) throw new Error(quoteBody.error ?? "Merchant could not produce a fresh basket quote.");
      const quote = quoteBody.quote;
      const approvalResponse = await fetch("/api/growth-approval", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quote, maxSpendPaise: maxSpend * 100, reason: request }),
      });
      const approvalBody = await approvalResponse.json() as { transaction?: Transaction; authorization?: { authorizationId?: string }; error?: string };
      if (!approvalResponse.ok || !approvalBody.transaction) throw new Error(approvalBody.error ?? "MANDATE rejected the approved basket.");
      const nextTransaction = approvalBody.transaction;
      setTransaction(nextTransaction);
      setActivity((current) => [...current, `Fresh quote verified at ${money(quote.totalPaise)}`, "Signed buyer mandate accepted by gateway", nextTransaction.state === "policy_authorized" ? "MANDATE policy authorized this exact basket" : `MANDATE returned ${nextTransaction.state}`]);
      setStage(nextTransaction.state === "policy_authorized" ? "authorized" : "blocked");
    } catch (caught) {
      setStage("ready");
      setError(caught instanceof Error ? caught.message : "Basket approval failed.");
    }
  }

  async function prepareRazorpayCheckout() {
    if (!transaction || transaction.state !== "policy_authorized") return;
    setError("");
    try {
      setActivity((current) => [...current, "Creating Razorpay Test Mode order"]);
      const response = await fetch(`${GATEWAY_URL}/v1/transactions/${transaction.id}/razorpay-order`, { method: "POST" });
      const body = await response.json() as { transaction?: Transaction; order?: { id: string; amount: number; currency: string }; checkout?: { keyId: string; currency: "INR" }; error?: string };
      if (!response.ok || !body.transaction || !body.order || !body.checkout) throw new Error(body.error ?? "Unable to create the Razorpay Test Mode order.");
      setTransaction(body.transaction);
      setCheckout({ keyId: body.checkout.keyId, currency: body.checkout.currency, order: body.order });
      await fetch(`${GATEWAY_URL}/v1/transactions/${transaction.id}/checkout-started`, { method: "POST" });
      setStage("payment");
      setActivity((current) => [...current, `Razorpay Test Mode order ${body.order!.id} created`]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Razorpay checkout could not be prepared.");
    }
  }

  async function retryPayment() {
    if (!transaction || transaction.state !== "payment_failed") return;
    setError("");
    setCheckout(null);
    setStage("working");
    setActivity((current) => [...current, "Starting a fresh payment transaction", "Re-running gateway recovery path"]);
    try {
      const response = await fetch(`${GATEWAY_URL}/v1/transactions/${transaction.id}/retry-payment`, { method: "POST" });
      const body = await response.json() as { transaction?: Transaction; error?: string };
      if (!response.ok || !body.transaction) throw new Error(body.error ?? "Unable to start a payment retry.");
      setTransaction(body.transaction);
      setActivity((current) => [...current, "Original failed attempt preserved", "New transaction created for retry"]);
      setStage(body.transaction.state === "policy_authorized" ? "authorized" : "blocked");
    } catch (caught) {
      setStage("ready");
      setError(caught instanceof Error ? caught.message : "Payment retry failed.");
    }
  }

  function launchRazorpay() {
    if (!transaction || !checkout) return;
    const RazorpayCtor = (window as unknown as { Razorpay?: new (options: Record<string, unknown>) => { open: () => void } }).Razorpay;
    if (!RazorpayCtor) {
      setError("Razorpay Checkout script is still loading. Try again in a moment.");
      return;
    }
    const instance = new RazorpayCtor({
      key: checkout.keyId,
      amount: checkout.order.amount,
      currency: checkout.currency,
      name: "Mandate Market",
      description: transaction.intent.reason,
      order_id: checkout.order.id,
      theme: { color: "#171717" },
      handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
        setActivity((current) => [...current, "Checkout returned payment identifiers", "Verifying payment on the gateway"]);
        const verifyResponse = await fetch(`${GATEWAY_URL}/v1/transactions/${transaction.id}/verify-payment`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(response),
        });
        const body = await verifyResponse.json() as { transaction?: Transaction; verified?: boolean; error?: string };
        if (!verifyResponse.ok || !body.transaction) {
          setError(body.error ?? "Payment verification failed.");
          return;
        }
        setTransaction(body.transaction);
        setStage(body.verified ? "paid" : "payment");
        setActivity((current) => [...current, body.verified ? "Payment verified by gateway" : "Payment is awaiting capture"]);
      },
      modal: { ondismiss: () => setActivity((current) => [...current, "Checkout closed before completion"]) },
    });
    instance.open();
  }

  return <main className="buyer-shell">
    <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
    <header className="buyer-header"><div className="brand"><span className="brand-mark">M</span><span>MANDATE</span></div><div className="header-right"><span className="live-dot" /> Buyer Agent <span className="divider" /> Razorpay Test Mode</div></header>
    <section className="buyer-grid">
      <section className="request-column">
        <div className="section-kicker">AI BUYER</div>
        <h1>Autonomous purchase workspace</h1>
        <p className="lede">The buyer agent researches, compares, recovers and constructs a basket. Money still requires explicit approval and the MANDATE gateway.</p>
        <label className="field-label" htmlFor="request">Request</label>
        <textarea id="request" value={request} onChange={(event) => setRequest(event.target.value)} />
        <div className="limit-row"><div><label className="field-label" htmlFor="limit">Maximum spend</label><div className="currency-input"><span>₹</span><input id="limit" type="number" min={0} step={100} value={maxSpend} onChange={(event) => setMaxSpend(Number(event.target.value) || 0)} /></div></div><div className="policy-note"><strong>Immutable policy</strong><span>The buyer model can never raise this limit.</span></div></div>
        <button className="run-button" onClick={() => void runAgent()} disabled={stage === "working" || !request.trim()}>{stage === "working" ? "Agent working…" : "Run buyer agent"}<span>→</span></button>
        {readyForApproval ? <div className="basket-approval"><div className="panel-kicker">BUYER AGENT PROPOSAL</div><strong>Review before money moves</strong><p>The agent completed its shopping task and is waiting for explicit approval.</p>{basket.map((item) => <div className="basket-option" key={item.productId}><div><code>{item.productId}</code><span>{item.quantity} × selected</span></div></div>)}<div className="basket-actions"><button onClick={() => void approveBasket()}>Approve basket →</button></div></div> : null}
        {transaction?.state === "policy_authorized" && !checkout ? <button className="pay-button" onClick={() => void prepareRazorpayCheckout()}>Create Razorpay Test Order <span>→</span></button> : null}
        {checkout && stage === "payment" ? <button className="pay-button pay-ready" onClick={launchRazorpay}>Open Razorpay Test Checkout <span>↗</span></button> : null}
        {paymentFailed ? <button className="pay-button" onClick={() => void retryPayment()}>Try payment again <span>↻</span></button> : null}
        {error ? <div className="error-box">{error}</div> : null}
        <div className="workspace-footer"><span>Merchant: {agentWorkspace?.manifest?.name ?? "Mandate Market"}</span><span>Payment authority: MANDATE gateway only</span></div>
      </section>
      <section className="decision-column">
        <div className="decision-header"><div><span className={`status status-${stage}`}>{statusLabel}</span><span className="decision-label">Buyer agent run</span></div>{agentRun ? <code>{agentRun.id}</code> : transaction ? <code>{transaction.id}</code> : <span className="quiet">No run yet</span>}</div>
        {agentRun ? <div className="product-panel"><div className="panel-heading"><span className="panel-kicker">AGENT STATE</span><span>{agentRun.stepCount}/{agentRun.constraints.maxSteps} steps</span></div><div className="policy-grid"><div><span>Planner</span><strong>{agentRun.plannerModel ?? "Model-directed"}</strong></div><div><span>Planner calls</span><strong>{agentRun.plannerCalls ?? 0}</strong></div></div>{agentRun.lastError ? <div className="model-reason"><span>RECOVERY / ERROR</span><p>{agentRun.lastError}</p></div> : null}</div> : null}
        {agentTrace.length ? <div className="activity-panel"><div className="panel-heading"><span className="panel-kicker">BUYER AGENT TRACE</span><span>{agentTrace.length} steps</span></div><div className="timeline">{agentTrace.map((step) => <div className="timeline-row" key={`${agentRun?.id ?? "run"}-${step.step}`}><span className={`timeline-dot ${step.status === "succeeded" ? "done" : ""}`} /><span><strong>#{step.step} {step.tool}</strong>{step.status === "failed" ? ` — recovered from ${step.error ?? "tool failure"}` : step.reason ? ` — ${step.reason}` : ""}</span></div>)}</div></div> : null}
        {blockedBySpend ? <div className="block-banner"><div><span className="block-eyebrow">POLICY GATE</span><strong>Purchase stopped before Razorpay</strong><span>The verified basket total exceeds the user's hard spending limit.</span></div><span className="block-badge">NO ORDER CREATED</span></div> : null}
        {paymentFailed ? <div className="block-banner failure-banner"><div><span className="block-eyebrow">PAYMENT RECOVERY</span><strong>Payment attempt failed</strong><span>The failed attempt is preserved; retry creates a new transaction.</span></div><span className="block-badge">SAFE TO RETRY</span></div> : null}
        <div className="product-panel"><span className="panel-kicker">SELECTED PRODUCT</span>{product ? <><div className="product-main"><div><h2>{product.name}</h2><p>{product.shortDescription ?? "Selected from live merchant catalog."}</p></div><strong>{money(product.pricePaise)}</strong></div><div className="feature-list">{product.features.slice(0, 4).map((feature) => <span key={feature}>✓ {feature}</span>)}</div></> : <div className="empty-selection"><span>—</span><p>Run the buyer agent to see a live multi-step decision.</p></div>}</div>
        {agentWorkspace?.recommendations.length ? <div className="basket-panel"><div className="panel-heading"><span className="panel-kicker">MERCHANT OFFERS OBSERVED</span><span>{agentWorkspace.recommendations.length}</span></div>{agentWorkspace.recommendations.slice(0, 3).map((recommendation) => <div className="basket-line" key={recommendation.productId}><code>{recommendation.productId}</code><span>{recommendation.type} · {money(recommendation.incrementalRevenuePaise)}</span></div>)}</div> : null}
        {basket.length > 1 ? <div className="basket-panel"><div className="panel-heading"><span className="panel-kicker">PROPOSED BASKET</span><span>{basket.length} lines</span></div>{basket.map((line) => <div className="basket-line" key={line.productId}><code>{line.productId}</code><span>× {line.quantity}</span></div>)}</div> : null}
        <div className="policy-panel"><div className="panel-heading"><span className="panel-kicker">POLICY</span><span>{remaining ? `${money(remaining)} remaining` : selectedAmount ? "Limit reached" : "Awaiting evaluation"}</span></div><div className="policy-grid"><div><span>Maximum spend</span><strong>{money(maxSpend * 100)}</strong></div><div><span>Current basket</span><strong>{selectedAmount ? money(selectedAmount) : "—"}</strong></div></div><div className="check-list">{transaction?.policy?.checks.map((check) => <div className="check-row" key={check.rule}><span className={`check ${check.result === "PASS" ? "pass" : "fail"}`}>{check.result === "PASS" ? "✓" : "×"}</span><div><strong>{check.rule.replaceAll("_", " ")}</strong><small>{check.reason}</small></div><code>{check.observed}</code></div>) ?? <div className="check-placeholder">Gateway policy checks appear after explicit approval.</div>}</div></div>
        {transaction?.state === "policy_blocked" ? <div className="error-box"><strong>Payment not initiated.</strong><br />The policy engine stopped this purchase before a Razorpay Order was created.</div> : null}
        <div className="activity-panel"><div className="panel-heading"><span className="panel-kicker">ACTIVITY</span><span>Application events</span></div><div className="timeline">{(activity.length ? activity : ["Waiting for a request"]).map((item, index) => <div className="timeline-row" key={`${item}-${index}`}><span className={`timeline-dot ${activity.length ? "done" : ""}`} /><span>{item}</span></div>)}</div></div>
        {transaction?.razorpayOrderId || transaction?.razorpayPaymentId ? <div className="refs-panel"><div><span>Razorpay order</span><code>{transaction.razorpayOrderId ?? "—"}</code></div><div><span>Payment</span><code>{transaction.razorpayPaymentId ?? "—"}</code></div></div> : null}
      </section>
    </section>
  </main>;
}
