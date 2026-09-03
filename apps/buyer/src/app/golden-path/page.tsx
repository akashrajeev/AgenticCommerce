"use client";

import Link from "next/link";
import Script from "next/script";
import { useMemo, useState } from "react";

type Product = { id: string; name: string; pricePaise: number; rating: number; inventory: number; shortDescription: string; features: string[] };
type Recommendation = { productId: string; quantity: number; rationale: string; name?: string; pricePaise?: number };
type Plan = { selectedProductId: string; decisionSummary: string; rankedProducts: Array<{ productId: string; score: number; rationale: string }>; basketRecommendations: Recommendation[] };
type QuoteLine = { productId: string; quantity: number; unitPricePaise: number; lineTotalPaise: number };
type Quote = { quoteId: string; totalPaise: number; subtotalPaise: number; shippingPaise: number; taxPaise: number; discountPaise: number; expiresAt: string; lineItems: QuoteLine[] };
type Check = { rule: string; result: "PASS" | "FAIL"; observed: string; expected: string; reason: string };
type Transaction = { id: string; state: string; quote: Quote; razorpayOrderId?: string; razorpayPaymentId?: string; policy?: { decision: "ALLOW" | "BLOCK"; checks: Check[] } };
type Order = { id: string; amount: number; currency: string };
type Stage = "idle" | "planning" | "approval" | "authorizing" | "authorized" | "payment" | "paid" | "blocked";

const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
const defaultRequest = "Find me the best ANC headphones under ₹5,000 and suggest one useful add-on if it stays within my limit.";

export default function GoldenPathPage() {
  const [request, setRequest] = useState(defaultRequest);
  const [maxSpend, setMaxSpend] = useState(5500);
  const [product, setProduct] = useState<Product | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [approved, setApproved] = useState(false);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");

  const firstRecommendation = recommendations[0];
  const upliftPaise = transaction ? Math.max(transaction.quote.totalPaise - (product?.pricePaise ?? 0), 0) : (firstRecommendation?.pricePaise ?? 0) * (firstRecommendation?.quantity ?? 0);
  const steps = useMemo<Array<{ number: string; label: string; complete: boolean }>>(() => [
    { number: "01", label: "AI PLAN", complete: stage !== "idle" },
    { number: "02", label: "USER APPROVAL", complete: approved || ["authorized", "payment", "paid", "blocked"].includes(stage) },
    { number: "03", label: "POLICY GATE", complete: ["authorized", "payment", "paid", "blocked"].includes(stage) },
    { number: "04", label: "PAYMENT", complete: ["payment", "paid"].includes(stage) },
  ], [stage, approved]);

  async function buildPlan() {
    setStage("planning"); setError(""); setApproved(false); setTransaction(null); setOrder(null); setPlan(null); setProduct(null); setRecommendations([]);
    try {
      const response = await fetch("/api/agent/purchase-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request, maxSpendPaise: maxSpend * 100 }) });
      const body = await response.json() as { plan?: Plan; selectedProduct?: Product; error?: string; detail?: string };
      if (!response.ok || !body.plan || !body.selectedProduct) throw new Error(body.detail ?? body.error ?? "AI buyer planning failed.");
      setPlan(body.plan); setProduct(body.selectedProduct);
      const recResponse = await fetch(`/api/golden-path/recommendations?productId=${encodeURIComponent(body.selectedProduct.id)}&maxSpendPaise=${encodeURIComponent(String(maxSpend * 100))}`, { cache: "no-store" });
      const recBody = await recResponse.json() as { recommendations?: Recommendation[] };
      if (recResponse.ok) setRecommendations((recBody.recommendations ?? []).filter((item) => item.productId !== body.selectedProduct?.id).slice(0, 2));
      setStage("approval");
    } catch (caught) {
      setStage("idle"); setError(caught instanceof Error ? caught.message : "AI buyer planning failed.");
    }
  }

  async function authorize(includeAddOn: boolean) {
    if (!product) return;
    const selected = includeAddOn && firstRecommendation ? [firstRecommendation] : [];
    const lines = [{ productId: product.id, quantity: 1 }, ...selected.map((item) => ({ productId: item.productId, quantity: item.quantity }))];
    setStage("authorizing"); setError(""); setApproved(includeAddOn);
    try {
      const response = await fetch("/api/golden-path/authorize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lines, maxSpendPaise: maxSpend * 100, reason: request }), cache: "no-store" });
      const body = await response.json() as { transaction?: Transaction; error?: string };
      if (!response.ok || !body.transaction) throw new Error(body.error ?? "Gateway authorization failed.");
      setTransaction(body.transaction); setStage(body.transaction.state === "policy_authorized" ? "authorized" : "blocked");
    } catch (caught) {
      setStage("approval"); setError(caught instanceof Error ? caught.message : "Gateway authorization failed.");
    }
  }

  async function createOrder() {
    if (!transaction || transaction.state !== "policy_authorized") return;
    setStage("payment"); setError("");
    try {
      const response = await fetch("/api/golden-path/order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactionId: transaction.id }), cache: "no-store" });
      const body = await response.json() as { transaction?: Transaction; order?: Order; error?: string };
      if (!response.ok || !body.transaction || !body.order) throw new Error(body.error ?? "Razorpay order creation failed.");
      setTransaction(body.transaction); setOrder(body.order);
    } catch (caught) {
      setStage("authorized"); setError(caught instanceof Error ? caught.message : "Razorpay order creation failed.");
    }
  }

  function launchCheckout() {
    if (!transaction || !order) return;
    const RazorpayCtor = (window as unknown as { Razorpay?: new (options: Record<string, unknown>) => { open: () => void } }).Razorpay;
    if (!RazorpayCtor) { setError("Razorpay Checkout is still loading."); return; }
    const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    if (!keyId) { setError("NEXT_PUBLIC_RAZORPAY_KEY_ID is not configured for this demo."); return; }
    const instance = new RazorpayCtor({ key: keyId, amount: order.amount, currency: order.currency, name: "Mandate Market", description: request, order_id: order.id, theme: { color: "#171717" }, handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
      try {
        const verifyResponse = await fetch("/api/golden-path/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactionId: transaction.id, ...response }) });
        const body = await verifyResponse.json() as { transaction?: Transaction; verified?: boolean; error?: string };
        if (!verifyResponse.ok || !body.transaction) throw new Error(body.error ?? "Payment verification failed.");
        setTransaction(body.transaction); setStage(body.verified ? "paid" : "payment");
      } catch (caught) { setError(caught instanceof Error ? caught.message : "Payment verification failed."); }
    } });
    instance.open();
  }

  return <main style={{ minHeight: "100vh", background: "#f7f7f3", color: "#171717", fontFamily: "Arial, sans-serif", padding: "34px 20px 70px" }}>
    <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
    <div style={{ maxWidth: 1120, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}><Link href="/" style={{ color: "#666", textDecoration: "none", fontSize: 13 }}>← Buyer workspace</Link><span style={{ border: "1px solid #c8d8ce", background: "#eff6f1", color: "#1e5b3e", padding: "7px 10px", fontSize: 11, fontWeight: 700 }}>GOLDEN PATH · TRACK 01</span></header>
      <div style={{ borderTop: "2px solid #171717", paddingTop: 18 }}><div style={{ fontSize: 11, color: "#777", letterSpacing: ".12em", fontWeight: 700 }}>MANDATE / CANONICAL DEMO</div><h1 style={{ fontSize: 52, letterSpacing: "-.055em", lineHeight: 1.02, margin: "10px 0 12px", maxWidth: 860 }}>AI recommends. You approve. Policy authorizes. Razorpay executes.</h1><p style={{ maxWidth: 820, color: "#666", lineHeight: 1.7, margin: 0 }}>One reproducible Track 01 scenario from natural-language intent to a verified Test Mode payment.</p></div>

      <section style={{ marginTop: 28, display: "grid", gridTemplateColumns: "1.1fr .9fr", gap: 14 }}>
        <div style={{ background: "white", border: "1px solid #dddcd7", padding: 22 }}><div style={{ fontSize: 10, letterSpacing: ".1em", fontWeight: 700, color: "#777" }}>1 · USER REQUEST</div><textarea value={request} onChange={(event) => setRequest(event.target.value)} style={{ width: "100%", minHeight: 90, marginTop: 12, border: "1px solid #d4d3ce", padding: 13, font: "inherit", lineHeight: 1.5 }} /><div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", marginTop: 14, gap: 18 }}><div><div style={{ fontSize: 10, color: "#777", letterSpacing: ".08em", fontWeight: 700 }}>HARD LIMIT</div><div style={{ display: "flex", alignItems: "center", border: "1px solid #d4d3ce", marginTop: 7 }}><span style={{ paddingLeft: 10, color: "#777" }}>₹</span><input type="number" min={0} value={maxSpend} onChange={(event) => setMaxSpend(Number(event.target.value) || 0)} style={{ border: 0, padding: 10, width: 120, outline: "none" }} /></div></div><button onClick={() => void buildPlan()} disabled={stage === "planning" || stage === "authorizing"} style={{ border: 0, background: "#171717", color: "white", padding: "12px 16px", fontWeight: 700 }}>{stage === "planning" ? "Planning…" : "Run buyer →"}</button></div></div>
        <div style={{ background: "#171717", color: "white", padding: 22 }}><div style={{ fontSize: 10, color: "#bcbcb8", letterSpacing: ".1em", fontWeight: 700 }}>TRUST MODEL</div><div style={{ fontSize: 24, lineHeight: 1.25, marginTop: 13 }}>The model never receives payment authority.</div><div style={{ marginTop: 16, color: "#c9c9c5", fontSize: 12, lineHeight: 1.75 }}>AI interprets intent. Merchant APIs supply commerce truth. The gateway decides whether money may move. Razorpay executes only an authorized order.</div></div>
      </section>

      {error ? <div style={{ marginTop: 16, background: "#f6e9e7", border: "1px solid #dfc1bc", color: "#7b302b", padding: 15, fontSize: 13 }}>{error}</div> : null}

      <section style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>{steps.map((step) => <div key={step.number} style={{ background: step.complete ? "#eff6f1" : "white", border: `1px solid ${step.complete ? "#c5d6ca" : "#dddcd7"}`, padding: 16 }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".08em", fontWeight: 700 }}>{step.number}</div><div style={{ fontSize: 12, fontWeight: 700, marginTop: 7 }}>{step.label}</div><div style={{ marginTop: 12, fontSize: 20, color: step.complete ? "#1e5b3e" : "#aaa" }}>{step.complete ? "✓" : "○"}</div></div>)}</section>

      {plan && product ? <section style={{ marginTop: 18, background: "white", border: "1px solid #dddcd7", padding: 22 }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>AI BUYER + MERCHANT REVENUE OPPORTUNITY</div><div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr .95fr", gap: 22 }}><div><div style={{ fontSize: 28, fontWeight: 700 }}>{product.name}</div><div style={{ marginTop: 5, color: "#666", fontSize: 13 }}>{plan.decisionSummary}</div><div style={{ display: "flex", gap: 18, marginTop: 16, fontSize: 12 }}><span>Rating <strong>{product.rating}</strong></span><span>Inventory <strong>{product.inventory}</strong></span><span>Price <strong>{money(product.pricePaise)}</strong></span></div></div><div style={{ borderLeft: "1px solid #e8e7e2", paddingLeft: 20 }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".08em", fontWeight: 700 }}>MERCHANT OPPORTUNITY</div>{firstRecommendation ? <><div style={{ fontSize: 16, fontWeight: 700, marginTop: 8 }}>Add an accessory?</div><div style={{ marginTop: 7, fontSize: 12, color: "#666" }}>{firstRecommendation.productId} · quantity {firstRecommendation.quantity}</div><div style={{ marginTop: 7, fontSize: 12, color: "#555" }}>{firstRecommendation.rationale}</div></> : <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>No additional merchant opportunity returned.</div>}</div></div></section> : null}

      {product && stage === "approval" ? <section style={{ marginTop: 18, background: "#fffdf3", border: "1px solid #e4d9af", padding: 20 }}><div style={{ fontSize: 10, color: "#75672c", letterSpacing: ".1em", fontWeight: 700 }}>2 · EXPLICIT USER APPROVAL</div><div style={{ fontSize: 20, fontWeight: 700, marginTop: 8 }}>Choose the basket the buyer is allowed to request.</div><div style={{ color: "#6f6a57", fontSize: 12, marginTop: 7 }}>The merchant recommendation never enters the payment request without your approval.</div><div style={{ display: "flex", gap: 10, marginTop: 16 }}><button onClick={() => void authorize(false)} style={{ border: "1px solid #aaa", background: "white", padding: "12px 15px", fontWeight: 700 }}>Primary product only →</button>{firstRecommendation ? <button onClick={() => void authorize(true)} style={{ border: 0, background: "#171717", color: "white", padding: "12px 15px", fontWeight: 700 }}>Approve add-on →</button> : null}</div></section> : null}

      {transaction ? <section style={{ marginTop: 18, background: "white", border: "1px solid #dddcd7" }}><div style={{ padding: 20, borderBottom: "1px solid #e8e7e2", display: "flex", justifyContent: "space-between", gap: 18 }}><div><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>3 · GATEWAY DECISION</div><div style={{ fontSize: 27, fontWeight: 700, marginTop: 8 }}>{stage === "blocked" ? "Basket blocked before Razorpay" : stage === "paid" ? "Payment verified" : "Policy authorized"}</div><div style={{ marginTop: 5, color: "#777", fontFamily: "monospace", fontSize: 11 }}>{transaction.id}</div></div><span style={{ padding: "8px 10px", background: stage === "blocked" ? "#f7e7e4" : "#eaf4ed", color: stage === "blocked" ? "#8d332d" : "#1e5b3e", height: "fit-content", fontSize: 11, fontWeight: 700 }}>{transaction.state.replaceAll("_", " ")}</span></div><div style={{ padding: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}><div><div style={{ fontSize: 10, color: "#777", letterSpacing: ".08em", fontWeight: 700 }}>BASKET ECONOMICS</div><div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}><span>Final quote</span><strong>{money(transaction.quote.totalPaise)}</strong></div><div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}><span>Hard limit</span><strong>{money(maxSpend * 100)}</strong></div><div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}><span>Incremental basket value</span><strong>{money(upliftPaise)}</strong></div></div><div><div style={{ fontSize: 10, color: "#777", letterSpacing: ".08em", fontWeight: 700 }}>POLICY CHECKS</div>{transaction.policy?.checks.map((check) => <div key={check.rule} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #eeeeea", fontSize: 11 }}><span><strong style={{ color: check.result === "PASS" ? "#1e5b3e" : "#9b3a32" }}>{check.result === "PASS" ? "✓" : "×"}</strong> {check.rule.replaceAll("_", " ")}</span><code>{check.observed}</code></div>)}</div></div><div style={{ padding: 20, background: "#fafaf7", borderTop: "1px solid #e8e7e2", display: "flex", justifyContent: "space-between", alignItems: "center" }}><div><strong>{stage === "blocked" ? "NO RAZORPAY ORDER" : order ? "RAZORPAY TEST ORDER READY" : "POLICY AUTHORIZED"}</strong><div style={{ color: "#777", fontSize: 11, marginTop: 5 }}>{order ? `${order.id} · ${money(order.amount)}` : stage === "blocked" ? "The payment rail was never reached." : "Create the Test Mode order only after authorization."}</div></div>{stage === "authorized" ? <button onClick={() => void createOrder()} style={{ border: 0, background: "#171717", color: "white", padding: "11px 14px", fontWeight: 700 }}>Create Razorpay Test Order →</button> : order && stage === "payment" ? <button onClick={launchCheckout} style={{ border: 0, background: "#171717", color: "white", padding: "11px 14px", fontWeight: 700 }}>Open Razorpay Checkout ↗</button> : null}</div></section> : null}

      <div style={{ marginTop: 24, paddingTop: 17, borderTop: "1px solid #d9d8d2", color: "#777", fontSize: 11, lineHeight: 1.7 }}>Canonical evidence chain: AI plan → merchant recommendation → explicit approval → fresh merchant quote → deterministic policy → Razorpay Test Mode → server verification → webhook reconciliation → merchant order.</div>
    </div>
  </main>;
}
