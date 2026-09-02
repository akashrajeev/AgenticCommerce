import Link from "next/link";

export const dynamic = "force-dynamic";

const formatINR = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);

async function getTransactions() {
  const gateway = process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000";
  try {
    const response = await fetch(`${gateway}/v1/transactions`, { cache: "no-store" });
    if (!response.ok) return [] as Array<Record<string, unknown>>;
    const body = (await response.json()) as { transactions: Array<Record<string, unknown>> };
    return body.transactions;
  } catch {
    return [] as Array<Record<string, unknown>>;
  }
}

export default async function OperationsPage() {
  const transactions = await getTransactions();
  const blocks = transactions.filter((txn) => (txn.policy as { decision?: string } | undefined)?.decision === "BLOCK").length;
  const razorpayOrders = transactions.filter((txn) => Boolean(txn.razorpayOrderId)).length;
  const confirmed = transactions.filter((txn) => txn.state === "order_confirmed").length;

  return (
    <main className="ops-page">
      <header className="ops-header">
        <Link href="/" className="brand"><span className="brand-mark">M</span><span>Mandate Market</span></Link>
        <div className="ops-nav"><span>Operations</span><Link href="/">Storefront</Link><span className="mode-pill">Razorpay Test Mode</span></div>
      </header>

      <div className="ops-container">
        <div className="ops-title-row">
          <div><p className="eyebrow">Merchant operations</p><h1>Transactions</h1><p className="ops-copy">A live view of purchases proposed by agents and authorized through MANDATE.</p></div>
          <div className="ops-system"><span className="status-dot" /> Gateway online</div>
        </div>

        <section className="metrics-grid">
          <div><span>Transactions observed</span><strong>{transactions.length}</strong><small>Current gateway state</small></div>
          <div><span>Policy blocks</span><strong>{blocks}</strong><small>Stopped before Razorpay</small></div>
          <div><span>Razorpay orders</span><strong>{razorpayOrders}</strong><small>Test Mode orders created</small></div>
          <div><span>Merchant confirmations</span><strong>{confirmed}</strong><small>Verified payment path</small></div>
        </section>

        <section className="transaction-table">
          <div className="table-head"><span>Transaction</span><span>Product</span><span>Amount</span><span>Policy</span><span>Payment</span><span>State</span></div>
          {transactions.length ? transactions.map((transaction) => {
            const id = String(transaction.id);
            const intent = transaction.intent as { productId?: string } | undefined;
            const quote = transaction.quote as { totalPaise?: number } | undefined;
            const policy = transaction.policy as { decision?: string } | undefined;
            return (
              <Link className="table-row" key={id} href={`/operations/transactions/${encodeURIComponent(id)}`}>
                <code>{id}</code>
                <span>{intent?.productId ?? "—"}</span>
                <strong>{typeof quote?.totalPaise === "number" ? formatINR(quote.totalPaise) : "—"}</strong>
                <span className={`mini-status ${policy?.decision === "BLOCK" ? "bad" : "good"}`}>{policy?.decision ?? "Pending"}</span>
                <span>{transaction.razorpayPaymentId ? "Referenced" : "Not started"}</span>
                <span className="state-text">{String(transaction.state).replaceAll("_", " ")}</span>
              </Link>
            );
          }) : (
            <div className="table-empty"><strong>No agent transactions yet.</strong><span>Launch the buyer app and run the first purchase evaluation.</span></div>
          )}
        </section>

        <section className="ops-bottom-grid">
          <div className="ops-card"><p className="eyebrow">Agent commerce</p><h2>Machine-readable by default.</h2><p>Mandate Market exposes product, inventory and checkout interfaces so a buyer can discover the merchant without scraping the storefront.</p><a href="/.well-known/agent-commerce">View merchant manifest →</a></div>
          <div className="ops-card dark-card"><p className="eyebrow">Transaction principle</p><h2>AI can propose. The gateway authorizes.</h2><p>Razorpay credentials live outside the buyer application. A policy block stops before an order is created.</p><div className="flow-note"><span>AI</span><i>→</i><span>Policy</span><i>→</i><span>Razorpay</span></div></div>
        </section>
      </div>
    </main>
  );
}
