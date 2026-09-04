"use client";

import Script from "next/script";
import { useEffect, useMemo, useState } from "react";

type Opportunity = {
  offerTargetProductId: string;
  sourceProductId: string;
  sourceProductName: string;
  productName: string;
  score: number;
  rationale: string;
  incrementalRevenuePaise: number;
};

type Campaign = {
  id: string;
  name: string;
  objective: string;
  strategy: "CROSS_SELL" | "UPSELL";
  opportunities: Opportunity[];
};

type Candidate = {
  transactionId: string;
  authorizationId: string;
  productId: string | null;
  amountPaise: number | null;
  state: string;
  razorpayOrderId: string | null;
};

type RazorpayOrder = { id: string; amount: number; currency: string; status?: string };
type RazorpayCheckout = { keyId: string; currency: "INR" };
type Result = Candidate & { ok: boolean; body?: unknown; error?: string; order?: RazorpayOrder; checkout?: RazorpayCheckout };
type Payload = {
  campaign?: Campaign;
  campaigns?: Campaign[];
  candidates?: Candidate[];
  error?: string;
};
type TransactionSnapshot = { id: string; state: string; razorpayOrderId?: string; razorpayPaymentId?: string };

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

const gateway = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4000";

const money = (paise: number | null) => typeof paise === "number"
  ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100)
  : "—";

export default function CampaignOrchestratorPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [activeTransaction, setActiveTransaction] = useState("");
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const activeCampaign = useMemo(() => campaigns.find((item) => item.id === campaignId) ?? campaigns[0] ?? null, [campaigns, campaignId]);

  async function load(nextCampaignId?: string) {
    setLoading(true);
    setError("");
    try {
      const query = nextCampaignId ? `?campaignId=${encodeURIComponent(nextCampaignId)}` : "";
      const response = await fetch(`/api/campaign-orchestrator${query}`, { cache: "no-store" });
      const body = await response.json() as Payload;
      if (!response.ok) throw new Error(body.error ?? "Unable to load campaign orchestrator.");
      setCampaigns(body.campaigns ?? (body.campaign ? [body.campaign] : []));
      const resolved = body.campaign?.id ?? nextCampaignId ?? body.campaigns?.[0]?.id ?? "";
      setCampaignId(resolved);
      setCandidates(body.candidates ?? []);
      setSelected([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load campaign orchestrator.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function launch() {
    if (!activeCampaign || selected.length === 0) return;
    setRunning(true);
    setError("");
    try {
      const response = await fetch("/api/campaign-orchestrator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId: activeCampaign.id, transactionIds: selected }),
        cache: "no-store",
      });
      const body = await response.json() as { results?: Result[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Campaign launch failed.");
      const nextResults = body.results ?? [];
      setResults(nextResults);
      setStatuses(Object.fromEntries(nextResults.map((result) => [result.transactionId, result.ok ? "ORDER_CREATED" : result.error ?? "FAILED"])));
      await load(activeCampaign.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Campaign launch failed.");
    } finally {
      setRunning(false);
    }
  }

  function toggle(id: string) {
    setSelected((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : current.length < 5 ? [...current, id] : current);
  }

  async function pollTransaction(transactionId: string) {
    const terminal = new Set(["order_confirmed", "payment_failed", "cancelled"]);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        const response = await fetch(`${gateway}/v1/transactions`, { cache: "no-store" });
        if (!response.ok) continue;
        const body = await response.json() as { transactions?: TransactionSnapshot[] };
        const latest = body.transactions?.find((item) => item.id === transactionId);
        if (!latest) continue;
        setStatuses((current) => ({ ...current, [transactionId]: latest.state.toUpperCase() }));
        if (terminal.has(latest.state)) return latest;
      } catch { /* bounded polling; the transaction remains visible */ }
    }
    setStatuses((current) => ({ ...current, [transactionId]: "RECONCILIATION_PENDING" }));
    return null;
  }

  function openRazorpay(result: Result) {
    if (!result.ok || !result.order || !result.checkout) return;
    if (!window.Razorpay) { setError("Razorpay Checkout is still loading."); return; }
    setActiveTransaction(result.transactionId);
    setStatuses((current) => ({ ...current, [result.transactionId]: "CHECKOUT_OPEN" }));
    const instance = new window.Razorpay({
      key: result.checkout.keyId,
      amount: result.order.amount,
      currency: result.checkout.currency,
      name: "Mandate Market",
      description: activeCampaign?.name ?? "Merchant campaign cohort",
      order_id: result.order.id,
      handler: async (payment: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
        setStatuses((current) => ({ ...current, [result.transactionId]: "VERIFYING_SIGNATURE" }));
        try {
          const verify = await fetch(`${gateway}/v1/transactions/${encodeURIComponent(result.transactionId)}/verify-payment`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payment),
            cache: "no-store",
          });
          const body = await verify.json().catch(() => null) as { error?: string; verified?: boolean } | null;
          if (!verify.ok) throw new Error(body?.error ?? "Payment verification failed.");
          setStatuses((current) => ({ ...current, [result.transactionId]: body?.verified ? "PAYMENT_VERIFIED" : "RECONCILING" }));
          const latest = await pollTransaction(result.transactionId);
          if (latest?.state === "order_confirmed") setStatuses((current) => ({ ...current, [result.transactionId]: "ORDER_CONFIRMED" }));
          else if (latest?.state === "payment_failed") setStatuses((current) => ({ ...current, [result.transactionId]: "PAYMENT_FAILED" }));
        } catch (caught) {
          setStatuses((current) => ({ ...current, [result.transactionId]: "VERIFY_FAILED" }));
          setError(caught instanceof Error ? caught.message : "Payment verification failed.");
        } finally { setActiveTransaction(""); }
      },
      modal: { ondismiss: () => { setStatuses((current) => ({ ...current, [result.transactionId]: "CHECKOUT_DISMISSED" })); setActiveTransaction(""); } },
    });
    instance.open();
  }

  const opportunityByProduct = useMemo(() => new Map((activeCampaign?.opportunities ?? []).map((item) => [item.offerTargetProductId, item])), [activeCampaign]);
  const expectedLift = selected.reduce((sum, id) => {
    const candidate = candidates.find((item) => item.transactionId === id);
    const opportunity = candidate?.productId ? opportunityByProduct.get(candidate.productId) : undefined;
    return sum + (opportunity?.incrementalRevenuePaise ?? 0);
  }, 0);
  const createdOrders = results.filter((result) => result.ok && result.order && result.checkout);
  const confirmedOrders = createdOrders.filter((result) => statuses[result.transactionId] === "ORDER_CONFIRMED").length;

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
      <main style={{ minHeight: "100vh", background: "#f4f4f1", color: "#171717", fontFamily: "Arial, sans-serif", padding: "34px 20px 68px" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto" }}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 24 }}>
            <div>
              <div style={{ fontSize: 11, color: "#1e5b3e", letterSpacing: ".14em", fontWeight: 800 }}>MERCHANT AGENT · TEST MODE</div>
              <h1 style={{ fontSize: 48, lineHeight: 1, letterSpacing: "-.05em", margin: "10px 0 12px" }}>Campaign orchestrator</h1>
              <p style={{ maxWidth: 780, color: "#666", lineHeight: 1.7, margin: 0 }}>Turn a merchant growth strategy into real, bounded Razorpay Test Mode orders. Only existing MANDATE-authorized transactions that match the campaign opportunity can enter a cohort.</p>
            </div>
            <div style={{ display: "flex", gap: 14 }}>
              <a href="/growth" style={{ color: "#171717", fontWeight: 700, textDecoration: "none" }}>Growth dashboard →</a>
              <a href="/" style={{ color: "#777", textDecoration: "none" }}>Operations</a>
            </div>
          </header>

          {error ? <div style={{ marginTop: 18, padding: 14, border: "1px solid #dfc1bc", background: "#f6e9e7", color: "#7b302b", fontSize: 12 }}>{error}</div> : null}

          <section style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <section style={{ background: "white", border: "1px solid #dddcd7", padding: 22 }}>
              <div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 800 }}>1 · CAMPAIGN</div>
              <select value={campaignId} disabled={loading || running} onChange={(event) => { setCampaignId(event.target.value); void load(event.target.value); }} style={{ width: "100%", marginTop: 10, padding: 12, border: "1px solid #ccc", background: "white", fontWeight: 700 }}>
                {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name} · {campaign.strategy}</option>)}
              </select>
              {activeCampaign ? <div style={{ marginTop: 16 }}><strong style={{ fontSize: 21 }}>{activeCampaign.objective}</strong><div style={{ marginTop: 14, display: "grid", gap: 8 }}>{activeCampaign.opportunities.map((opportunity) => <div key={`${opportunity.offerTargetProductId}:${opportunity.sourceProductId}`} style={{ border: "1px solid #e5e5e1", padding: 12, background: "#fafaf7" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><strong>{opportunity.sourceProductName} → {opportunity.productName}</strong><span style={{ color: "#1e5b3e", fontWeight: 800 }}>+{money(opportunity.incrementalRevenuePaise)}</span></div><div style={{ color: "#777", fontSize: 11, marginTop: 5 }}>score {opportunity.score} · {opportunity.rationale}</div></div>)}</div></div> : null}
            </section>

            <section style={{ background: "#171717", color: "white", padding: 22 }}>
              <div style={{ fontSize: 10, color: "#bbb", letterSpacing: ".1em", fontWeight: 800 }}>2 · LAUNCH RULE</div>
              <h2 style={{ fontSize: 25, margin: "8px 0 10px" }}>No mandate. No order.</h2>
              <p style={{ color: "#bbb", fontSize: 12, lineHeight: 1.7, margin: 0 }}>The orchestrator never accepts an arbitrary amount or payment ID. It selects only transactions already authorized by MANDATE and delegates order creation to the guarded MCP gateway.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
                <Metric label="Selected" value={`${selected.length}/5`} />
                <Metric label="Expected lift" value={money(expectedLift)} />
              </div>
              <button disabled={running || selected.length === 0 || !activeCampaign} onClick={() => void launch()} style={{ width: "100%", marginTop: 17, padding: 13, border: 0, background: "white", color: "#171717", fontWeight: 800, cursor: selected.length ? "pointer" : "not-allowed" }}>{running ? "Creating Test Mode orders…" : "Launch Test Mode cohort →"}</button>
            </section>
          </section>

          <section style={{ marginTop: 16, background: "white", border: "1px solid #dddcd7" }}>
            <div style={{ padding: 20, borderBottom: "1px solid #e6e6e2" }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 800 }}>3 · ELIGIBLE TRANSACTIONS</div><h2 style={{ margin: "7px 0 0", fontSize: 25 }}>Real MANDATE-authorized cohort candidates</h2></div>
            {loading ? <div style={{ padding: 22, color: "#777" }}>Reading live gateway state…</div> : candidates.length === 0 ? <div style={{ padding: 22, color: "#777" }}>No eligible authorized transactions. Run the flagship agent negotiation first.</div> : <div>{candidates.map((candidate) => { const checked = selected.includes(candidate.transactionId); return <label key={candidate.transactionId} style={{ display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 14, alignItems: "center", padding: 16, borderBottom: "1px solid #eee", background: checked ? "#f1f7f3" : "white", cursor: "pointer" }}><input type="checkbox" checked={checked} onChange={() => toggle(candidate.transactionId)} /><div><div style={{ fontWeight: 800 }}>{candidate.productId ?? "Transaction"}</div><div style={{ marginTop: 4, fontSize: 10, color: "#777", fontFamily: "monospace", wordBreak: "break-all" }}>{candidate.transactionId}</div><div style={{ marginTop: 4, fontSize: 10, color: "#777" }}>MANDATE {candidate.authorizationId} · {candidate.state}</div></div><div style={{ textAlign: "right" }}><strong>{money(candidate.amountPaise)}</strong><div style={{ fontSize: 10, color: candidate.razorpayOrderId ? "#1e5b3e" : "#777", marginTop: 4 }}>{candidate.razorpayOrderId ? "Razorpay order exists" : "No order yet"}</div></div></label>; })}</div>}
          </section>

          {results.length ? <section style={{ marginTop: 16, background: "white", border: "1px solid #dddcd7", padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 16 }}><div><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 800 }}>4 · REAL RAZORPAY TEST MODE RESULTS</div><h2 style={{ margin: "7px 0 0", fontSize: 25 }}>{createdOrders.length} real order{createdOrders.length === 1 ? "" : "s"} ready for Checkout</h2></div><div style={{ textAlign: "right", color: "#666", fontSize: 11 }}>{confirmedOrders} confirmed · {createdOrders.length - confirmedOrders} awaiting payment/reconciliation</div></div>
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>{results.map((result) => <div key={result.transactionId} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, alignItems: "center", border: "1px solid #e5e5e1", padding: 13 }}><div><div style={{ fontFamily: "monospace", fontSize: 10, wordBreak: "break-all" }}>{result.transactionId}</div><div style={{ color: "#777", fontSize: 10, marginTop: 4 }}>{statuses[result.transactionId] ?? (result.ok ? "ORDER_CREATED" : result.error ?? "FAILED")}</div></div>{result.ok && result.order ? <strong>{money(result.order.amount)}</strong> : <span />}{result.ok && result.checkout ? <button disabled={activeTransaction !== "" || statuses[result.transactionId] === "ORDER_CONFIRMED"} onClick={() => openRazorpay(result)} style={{ border: 0, background: "#1e5b3e", color: "white", padding: "9px 12px", fontWeight: 800, cursor: "pointer" }}>{statuses[result.transactionId] === "ORDER_CONFIRMED" ? "Confirmed" : activeTransaction === result.transactionId ? "Opening…" : "Pay in Test Mode →"}</button> : <strong style={{ color: "#8d332d" }}>{result.error ?? "FAILED"}</strong>}</div>)}</div>
            <p style={{ margin: "12px 0 0", color: "#777", fontSize: 11 }}>Complete each Test Mode order here. Captured payments are independently re-read through the MCP verification path before campaign uplift is counted on /growth and /growth-attribution.</p>
          </section> : null}

          <section style={{ marginTop: 16, background: "#171717", color: "white", padding: 20 }}><div style={{ fontSize: 10, letterSpacing: ".1em", color: "#aaa", fontWeight: 800 }}>COHORT EVIDENCE</div><div style={{ marginTop: 9, color: "#c8c8c4", lineHeight: 1.6, fontSize: 12 }}>Campaign objective → candidate scoring → MANDATE authorization → MCP order creation → Razorpay Test Mode Checkout → gateway signature verification → webhook/API reconciliation → merchant order → independent Razorpay settlement proof.</div></section>
        </div>
      </main>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div style={{ border: "1px solid #393939", padding: 12 }}><div style={{ fontSize: 9, color: "#aaa", letterSpacing: ".08em" }}>{label}</div><strong style={{ display: "block", marginTop: 5, fontSize: 22 }}>{value}</strong></div>;
}
