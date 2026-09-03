"use client";

import Script from "next/script";
import { useEffect, useMemo, useState } from "react";
import styles from "./negotiation.module.css";

type Mandate = {
  mandateId: string;
  purpose: string;
  merchantIds: string[];
  maxSpendPerPurchase: { currency: "INR"; amountPaise: number };
  totalBudget: { currency: "INR"; amountPaise: number };
  remainingDisplay: string;
  status: string;
};

type Offer = {
  offerId: string;
  intentId: string;
  merchantId: string;
  items: { productId: string; quantity: number; unitPricePaise: number; lineTotalPaise: number }[];
  amount: { currency: "INR"; amountPaise: number };
  quoteId: string;
  conditions: Record<string, string | number | boolean | null>;
  sourceProtocol: string;
  createdAt: string;
  expiresAt: string;
};

type Turn = {
  turnId: string;
  actor: "buyer_agent" | "merchant_agent";
  type: string;
  message: string;
  offerId?: string;
  createdAt: string;
};

type Negotiation = {
  negotiationId: string;
  merchant: { agentId: string; name: string };
  offers: Offer[];
  selectedOfferId: string;
  turns: Turn[];
  buyer: { agentId: string; name: string; selectionReason: string };
};

type Transaction = {
  id: string;
  state: string;
  razorpayOrderId?: string;
  mandateAuthorizationId?: string;
  quote: { totalPaise: number; currency: "INR"; lineItems: Offer["items"] };
};

type RazorpayCheckout = { keyId: string; currency: "INR"; order: { id: string; amount: number; currency: string } };

const gateway = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4000";

const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(paise / 100);

export default function NegotiationPage() {
  const [purpose, setPurpose] = useState("Find the best ANC headphones under ₹5,000");
  const [budget, setBudget] = useState("5000");
  const [mandates, setMandates] = useState<Mandate[]>([]);
  const [mandateId, setMandateId] = useState("");
  const [negotiation, setNegotiation] = useState<Negotiation | null>(null);
  const [selectedOfferId, setSelectedOfferId] = useState("");
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [checkout, setCheckout] = useState<RazorpayCheckout | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedMandate = useMemo(() => mandates.find((item) => item.mandateId === mandateId) ?? mandates.find((item) => item.status === "active"), [mandates, mandateId]);
  const selectedOffer = negotiation?.offers.find((offer) => offer.offerId === selectedOfferId) ?? negotiation?.offers.find((offer) => offer.offerId === negotiation.selectedOfferId);

  async function loadMandates() {
    const response = await fetch(`${gateway}/v1/delegated-mandates`, { cache: "no-store" });
    const body = await response.json();
    const next = Array.isArray(body.mandates) ? body.mandates.filter(Boolean) : [];
    setMandates(next);
    if (!mandateId) setMandateId(next.find((item: Mandate) => item.status === "active")?.mandateId ?? "");
  }

  useEffect(() => { void loadMandates().catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load mandates.")); }, []);

  async function issueDemoMandate() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${gateway}/v1/delegated-mandates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subjectId: "user_001",
          agentId: "buyer-agent:mandate-demo",
          purpose: "Agent-to-agent purchases within delegated budget",
          merchantIds: ["mandate-market"],
          maxSpendPerPurchase: { currency: "INR", amountPaise: 500000 },
          totalBudget: { currency: "INR", amountPaise: 1000000 },
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to issue mandate.");
      setMandateId(body.mandate.mandateId);
      await loadMandates();
      setMessage("Delegated mandate issued. The buyer agent can now accept qualifying merchant offers.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to issue mandate."); }
    finally { setBusy(false); }
  }

  async function negotiate() {
    setBusy(true); setMessage(""); setNegotiation(null); setTransaction(null); setCheckout(null);
    try {
      const response = await fetch("/api/agent/negotiate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request: purpose, maxSpendPaise: Math.round(Number(budget) * 100) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Negotiation failed.");
      setNegotiation(body as Negotiation);
      setSelectedOfferId(body.selectedOfferId);
      setMessage(`Buyer agent evaluated ${body.offers.length} merchant offer${body.offers.length === 1 ? "" : "s"} and selected one.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Negotiation failed."); }
    finally { setBusy(false); }
  }

  async function acceptOffer(tamper = false) {
    if (!selectedMandate || !selectedOffer || !negotiation) return;
    setBusy(true); setMessage(""); setTransaction(null); setCheckout(null);
    const offer = tamper ? { ...selectedOffer, amount: { ...selectedOffer.amount, amountPaise: selectedOffer.amount.amountPaise + 100 } } : selectedOffer;
    try {
      const response = await fetch(`${gateway}/v1/negotiations/${encodeURIComponent(negotiation.negotiationId)}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mandateId: selectedMandate.mandateId, offer }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Offer acceptance was blocked.");
      setTransaction({ ...body.transaction, mandateAuthorizationId: body.authorizationId });
      await loadMandates();
      setMessage(body.replayed ? "The previously accepted negotiation was replayed safely." : "Offer accepted. The gateway bound the merchant quote to the delegated mandate.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Offer acceptance failed."); }
    finally { setBusy(false); }
  }

  async function createRazorpayOrder() {
    if (!transaction?.mandateAuthorizationId) {
      setMessage("The transaction has no mandate authorization. Payment cannot bypass the authorization boundary.");
      return;
    }
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${gateway}/v1/mandates/${encodeURIComponent(transaction.mandateAuthorizationId)}/razorpay-order`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-mandate-gateway-secret": "" },
        body: JSON.stringify({ transactionId: transaction.id }),
      });
      const body = await response.json();
      if (!response.ok || !body.order || !body.checkout) throw new Error(body.error ?? "Unable to create Razorpay Test Mode order.");
      setCheckout({ keyId: body.checkout.keyId, currency: body.checkout.currency, order: body.order });
      setTransaction({ ...body.transaction, mandateAuthorizationId: transaction.mandateAuthorizationId });
      setMessage(`Razorpay Test Mode order ${body.order.id} is ready. Choose UPI in Checkout and use success@razorpay or failure@razorpay.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to create Razorpay order."); }
    finally { setBusy(false); }
  }

  function openRazorpay() {
    if (!transaction || !checkout) return;
    const RazorpayCtor = (window as unknown as { Razorpay?: new (options: Record<string, unknown>) => { open: () => void } }).Razorpay;
    if (!RazorpayCtor) { setMessage("Razorpay Checkout is still loading."); return; }
    const instance = new RazorpayCtor({
      key: checkout.keyId,
      amount: checkout.order.amount,
      currency: checkout.currency,
      name: "Mandate Market",
      description: "Negotiated offer",
      order_id: checkout.order.id,
      handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
        setMessage("Razorpay returned payment identifiers. Verifying the payment signature at the gateway…");
        const verify = await fetch(`${gateway}/v1/transactions/${transaction.id}/verify-payment`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(response) });
        const body = await verify.json();
        if (!verify.ok) { setMessage(body.error ?? "Payment verification failed."); return; }
        setTransaction({ ...body.transaction, mandateAuthorizationId: transaction.mandateAuthorizationId });
        setMessage(body.verified ? "Payment signature verified by the gateway. Wait for webhook reconciliation before merchant fulfillment." : "Payment returned and is awaiting final reconciliation.");
      },
    });
    instance.open();
  }

  return (
    <main className={styles.shell}>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
      <header className={styles.header}><div className={styles.brand}><span className={styles.mark}>M</span> MANDATE</div><div className={styles.headerLinks}><a href="/">Buyer workspace</a><a href="/delegated-mandates">Delegated authority</a></div></header>
      <section className={styles.grid}>
        <section className={styles.left}>
          <span className={styles.kicker}>PHASE 8 / REAL RAZORPAY TEST MODE</span>
          <h1>Let agents negotiate. Let MANDATE authorize. Let Razorpay execute.</h1>
          <p className={styles.lede}>The buyer agent states the intent. The merchant agent returns quote-backed offers. The trusted gateway binds the selected offer to the user&apos;s delegated authority before a Razorpay Test Mode order can exist.</p>
          <div className={styles.agentStrip}><span>BUYER AGENT</span><b>↔</b><span>MERCHANT AGENT</span><b>→</b><span>MANDATE</span><b>→</b><span>RAZORPAY</span></div>
          <label className={styles.label}>Shopping intent<textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} /></label>
          <div className={styles.two}><label className={styles.label}>Hard budget<input value={budget} onChange={(event) => setBudget(event.target.value)} inputMode="decimal" /></label><div className={styles.boundary}><span>PAYMENT BOUNDARY</span><strong>{selectedMandate ? selectedMandate.remainingDisplay : "No mandate"}</strong><small>remaining delegated budget</small></div></div>
          {selectedMandate ? <div className={styles.mandateBox}><div><span>ACTIVE MANDATE</span><strong>{selectedMandate.purpose}</strong><small>{money(selectedMandate.maxSpendPerPurchase.amountPaise)} max per purchase · {selectedMandate.mandateId}</small></div><select value={selectedMandate.mandateId} onChange={(event) => setMandateId(event.target.value)}>{mandates.filter((item) => item.status === "active").map((item) => <option key={item.mandateId} value={item.mandateId}>{item.mandateId}</option>)}</select></div> : <button className={styles.secondary} disabled={busy} onClick={() => void issueDemoMandate()}>Issue demo delegated mandate <span>₹10,000 total / ₹5,000 purchase</span></button>}
          <button className={styles.primary} disabled={busy || !purpose.trim() || !selectedMandate} onClick={() => void negotiate()}>{busy ? "Working…" : "Start negotiation"}<span>→</span></button>
          {message && <div className={styles.message}>{message}</div>}
          <div className={styles.message}><strong>UPI Test Mode:</strong> in Razorpay Checkout, choose UPI and use <code>success@razorpay</code> for a successful test payment or <code>failure@razorpay</code> for a failure. No real money moves in Test Mode.</div>
        </section>

        <section className={styles.right}>
          <div className={styles.rightHead}><div><span className={styles.panelKicker}>NEGOTIATION → PAYMENT TRACE</span><h2>{negotiation ? negotiation.negotiationId : "No negotiation yet"}</h2></div>{negotiation && <span className={styles.status}>PROPOSED</span>}</div>
          {negotiation ? <>
            <div className={styles.conversation}>{negotiation.turns.map((turn) => <div className={`${styles.turn} ${turn.actor === "merchant_agent" ? styles.merchant : styles.buyer}`} key={turn.turnId}><div className={styles.turnMeta}>{turn.actor === "buyer_agent" ? "BUYER AGENT" : "MERCHANT AGENT"}<span>{turn.type}</span></div><p>{turn.message}</p></div>)}</div>
            <div className={styles.offerHead}><span className={styles.panelKicker}>MERCHANT OFFERS</span><span>{negotiation.offers.length} available</span></div>
            <div className={styles.offers}>{negotiation.offers.map((offer) => <button key={offer.offerId} className={`${styles.offer} ${offer.offerId === selectedOfferId ? styles.selected : ""}`} onClick={() => setSelectedOfferId(offer.offerId)}><div><strong>{offer.items.map((item) => item.productId).join(" + ")}</strong><small>{offer.offerId} · quote {offer.quoteId}</small></div><div className={styles.offerPrice}>{money(offer.amount.amountPaise)}<small>{offer.offerId === negotiation.selectedOfferId ? "buyer choice" : "available"}</small></div></button>)}</div>
            <div className={styles.selection}><span className={styles.panelKicker}>BUYER DECISION</span><p>{negotiation.buyer.selectionReason}</p><div className={styles.actions}><button className={styles.accept} disabled={busy || !selectedOffer} onClick={() => void acceptOffer(false)}>Accept selected offer</button><button className={styles.tamper} disabled={busy || !selectedOffer} onClick={() => void acceptOffer(true)}>Tamper amount → test block</button></div></div>
            {transaction && <div className={styles.authorized}><div><span>MANDATE → RAZORPAY</span><strong>Authorized · {money(transaction.quote.totalPaise)}</strong><small>{transaction.id} · authorization {transaction.mandateAuthorizationId ?? "missing"}</small></div>{!checkout ? <button onClick={() => void createRazorpayOrder()} disabled={busy}>Create mandate-gated Test Order →</button> : <button onClick={openRazorpay} disabled={busy}>Open Razorpay Test Checkout ↗</button>}</div>}
          </> : <div className={styles.empty}><span>↔</span><p>Start a negotiation to see the buyer and merchant agents exchange an intent, live offers and a payment-bound authorization.</p></div>}
        </section>
      </section>
    </main>
  );
}
