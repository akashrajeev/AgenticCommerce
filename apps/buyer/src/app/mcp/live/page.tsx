"use client";

import Script from "next/script";
import { useState } from "react";

type Proof = { status: number; body: unknown } | null;
type Transaction = { id: string; state: string; razorpayOrderId?: string; razorpayPaymentId?: string };
type Checkout = { keyId: string; currency: "INR"; order: { id: string; amount: number; currency: string } };

const gateway = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4000";

export default function LiveMcpPaymentPage() {
  const [result, setResult] = useState<Proof>(null);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Run the authorized MCP tool first.");

  async function createOrder() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/mcp-lab", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "authorized-test-order" }), cache: "no-store" });
      const body = await response.json() as { transactionId?: string; body?: { result?: { structuredContent?: { transaction?: Transaction; checkout?: Checkout } } }; proof?: string; error?: string };
      setResult({ status: response.status, body });
      const structured = body.body?.result?.structuredContent;
      if (structured?.transaction) setTransaction(structured.transaction);
      if (structured?.checkout) setCheckout(structured.checkout);
      if (!response.ok) throw new Error(body.error ?? "Authorized MCP order creation failed.");
      setMessage(body.proof ?? "Real Razorpay Test Mode order created through MCP.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "MCP order creation failed."); }
    finally { setBusy(false); }
  }

  async function pay() {
    if (!checkout || !transaction) return;
    const RazorpayCtor = (window as unknown as { Razorpay?: new (options: Record<string, unknown>) => { open: () => void } }).Razorpay;
    if (!RazorpayCtor) { setMessage("Razorpay Checkout is still loading."); return; }
    setBusy(true);
    const instance = new RazorpayCtor({
      key: checkout.keyId,
      amount: checkout.order.amount,
      currency: checkout.currency,
      name: "Mandate Market",
      description: "Authorized MCP Test Mode payment",
      order_id: checkout.order.id,
      handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
        try {
          const verify = await fetch(`${gateway}/v1/transactions/${encodeURIComponent(transaction.id)}/verify-payment`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(response), cache: "no-store" });
          const body = await verify.json() as { verified?: boolean; transaction?: Transaction; error?: string };
          if (!verify.ok) throw new Error(body.error ?? "Payment verification failed.");
          if (body.transaction) setTransaction(body.transaction);
          setMessage(body.verified ? "Razorpay Test Mode signature verified. Refreshing transaction state…" : "Payment callback received; awaiting reconciliation.");
          for (let attempt = 0; attempt < 8; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            const latestBody = await fetch(`${gateway}/v1/transactions`, { cache: "no-store" }).then((res) => res.json()).catch(() => null) as { transactions?: Transaction[] } | null;
            const latest = latestBody?.transactions?.find((item) => item.id === transaction.id);
            if (latest) setTransaction(latest);
            if (latest?.state === "order_confirmed") { setMessage("Authorized MCP payment confirmed: Razorpay Test Mode → verification → merchant order."); break; }
            if (latest?.state === "payment_failed" || latest?.state === "cancelled") { setMessage(`Razorpay Test Mode reported ${latest.state}. No merchant order was confirmed.`); break; }
          }
        } catch (error) { setMessage(error instanceof Error ? error.message : "Payment verification failed."); }
        finally { setBusy(false); }
      },
    });
    instance.open();
  }

  return <><Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" /><main style={{ minHeight: "100vh", background: "#f6f6f2", color: "#171717", padding: 36, fontFamily: "Inter, Arial, sans-serif" }}><div style={{ maxWidth: 1040, margin: "0 auto" }}>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 20 }}><div><div style={{ fontSize: 11, color: "#1e5b3e", letterSpacing: 2, fontWeight: 800 }}>MCP → RAZORPAY TEST MODE</div><h1 style={{ fontSize: 48, lineHeight: 1, margin: "9px 0 12px" }}>Authorized tool call to real checkout.</h1><p style={{ maxWidth: 780, color: "#666", lineHeight: 1.65 }}>This proof starts with a real policy-authorized MANDATE transaction, creates a real Razorpay Test Mode order through MCP, and then uses Razorpay Checkout and server-side verification.</p></div><a href="/mcp/authorized" style={{ color: "#171717", fontWeight: 800 }}>← Authorization comparison</a></header>
    <section style={{ marginTop: 26, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}><div style={{ background: "white", border: "1px solid #ddd", padding: 22 }}><div style={{ fontSize: 10, color: "#777", letterSpacing: 1.5, fontWeight: 800 }}>1 · AUTHORIZE THROUGH MCP</div><h2 style={{ margin: "8px 0", fontSize: 25 }}>Create a real Test Mode order</h2><button disabled={busy} onClick={() => void createOrder()} style={{ padding: "12px 14px", border: 0, background: "#171717", color: "white", fontWeight: 800, cursor: "pointer" }}>{busy ? "Working…" : "Create via MCP"}</button>{transaction ? <div style={{ marginTop: 16, padding: 13, background: "#f7f7f5", fontFamily: "monospace", fontSize: 11, lineHeight: 1.7 }}>transaction = {transaction.id}<br />state = {transaction.state}<br />razorpayOrderId = {transaction.razorpayOrderId ?? "—"}</div> : null}<pre style={{ marginTop: 14, background: "#f7f7f5", padding: 12, overflow: "auto", minHeight: 180, fontSize: 10 }}>{result ? JSON.stringify(result.body, null, 2) : "No result yet."}</pre></div>
    <div style={{ background: "#171717", color: "white", padding: 22 }}><div style={{ fontSize: 10, color: "#aaa", letterSpacing: 1.5, fontWeight: 800 }}>2 · RAZORPAY TEST MODE</div><h2 style={{ margin: "8px 0", fontSize: 25 }}>Complete the real test payment</h2><p style={{ color: "#ccc", fontSize: 12, lineHeight: 1.6 }}>After the MCP order is created, open Checkout. Use the Razorpay Test Mode UPI flow and the documented test credentials for success/failure. The app never fabricates a payment ID.</p><button disabled={busy || !checkout} onClick={() => void pay()} style={{ padding: "12px 14px", border: 0, background: checkout ? "#d9e7df" : "#444", color: "#173e2b", fontWeight: 800, cursor: checkout ? "pointer" : "not-allowed" }}>{checkout ? "Open Razorpay Checkout" : "Waiting for MCP order"}</button>{transaction?.razorpayPaymentId ? <div style={{ marginTop: 16, padding: 13, background: "#232323", fontFamily: "monospace", fontSize: 11 }}>payment = {transaction.razorpayPaymentId}<br />state = {transaction.state}</div> : null}<div style={{ marginTop: 16, color: "#ccc", fontSize: 12, lineHeight: 1.5 }}>{message}</div></div></section>
    <section style={{ marginTop: 16, background: "white", border: "1px solid #ddd", padding: 20 }}><strong>Trust chain</strong><div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginTop: 12 }}>{["MANDATE", "MCP", "Razorpay order", "Checkout", "Verified order"].map((step) => <div key={step} style={{ padding: 12, border: "1px solid #e3e3e3", fontSize: 11, fontWeight: 800 }}>{step}</div>)}</div></section>
  </div></main></>;
}
