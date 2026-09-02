import Link from "next/link";

export const dynamic = "force-dynamic";

const money = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);

async function getTransaction(id: string) {
  const gateway = process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000";
  try {
    const response = await fetch(`${gateway}/v1/transactions/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { transaction: Record<string, unknown> };
    return body.transaction;
  } catch {
    return null;
  }
}

async function getTimeline(id: string) {
  const gateway = process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000";
  try {
    const response = await fetch(`${gateway}/v1/transactions/${encodeURIComponent(id)}/timeline`, { cache: "no-store" });
    if (!response.ok) return [];
    const body = (await response.json()) as { events: Array<Record<string, unknown>> };
    return body.events;
  } catch {
    return [];
  }
}

export default async function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [transaction, events] = await Promise.all([getTransaction(id), getTimeline(id)]);

  if (!transaction) {
    return <main className="ops-page"><div className="ops-container"><p className="eyebrow">Transaction</p><h1>Not found</h1><Link href="/operations">← Back to transactions</Link></div></main>;
  }

  const intent = transaction.intent as { reason?: string; productId?: string; quantity?: number; maxSpendPaise?: number };
  const quote = transaction.quote as { totalPaise?: number; currency?: string };
  const policy = transaction.policy as { decision?: string; checks?: Array<Record<string, unknown>> } | undefined;

  return (
    <main className="ops-page">
      <header className="ops-header">
        <Link href="/" className="brand"><span className="brand-mark">M</span><span>Mandate Market</span></Link>
        <div className="ops-nav"><Link href="/operations">Transactions</Link><span className="mode-pill">Razorpay Test Mode</span></div>
      </header>

      <div className="ops-container detail-container">
        <Link href="/operations" className="back-link">← All transactions</Link>
        <div className="detail-title">
          <div><p className="eyebrow">Transaction detail</p><h1>{id}</h1></div>
          <span className={`detail-state state-${String(transaction.state).replaceAll("_", "-")}`}>{String(transaction.state).replaceAll("_", " ")}</span>
        </div>

        <section className="detail-grid">
          <div className="detail-card wide">
            <p className="eyebrow">Purchase intent</p>
            <h2>{intent.reason ?? "—"}</h2>
            <div className="detail-facts">
              <div><span>Product</span><strong>{intent.productId ?? "—"}</strong></div>
              <div><span>Quantity</span><strong>{intent.quantity ?? "—"}</strong></div>
              <div><span>Maximum spend</span><strong>{typeof intent.maxSpendPaise === "number" ? money(intent.maxSpendPaise) : "—"}</strong></div>
              <div><span>Quoted total</span><strong>{typeof quote.totalPaise === "number" ? money(quote.totalPaise) : "—"}</strong></div>
            </div>
          </div>

          <div className="detail-card">
            <p className="eyebrow">Payment references</p>
            <dl className="ref-list">
              <div><dt>Razorpay order</dt><dd>{String(transaction.razorpayOrderId ?? "Not created")}</dd></div>
              <div><dt>Payment</dt><dd>{String(transaction.razorpayPaymentId ?? "Not received")}</dd></div>
              <div><dt>Currency</dt><dd>{String(quote.currency ?? "INR")}</dd></div>
            </dl>
          </div>

          <div className="detail-card">
            <p className="eyebrow">Policy decision</p>
            <div className={`decision-banner ${policy?.decision === "BLOCK" ? "blocked" : "allowed"}`}>{policy?.decision ?? "PENDING"}</div>
            <div className="compact-checks">{policy?.checks?.map((check) => <div key={String(check.rule)}><span>{String(check.result)}</span><strong>{String(check.rule).replaceAll("_", " ")}</strong></div>) ?? <span>Awaiting evaluation.</span>}</div>
          </div>
        </section>

        <section className="detail-card audit-card">
          <div className="audit-heading"><div><p className="eyebrow">Audit trail</p><h2>Every transition, recorded.</h2></div><span>{events.length} events</span></div>
          <div className="audit-table">
            {events.map((event) => (
              <div className="audit-row" key={String(event.id)}>
                <div className="audit-time">{new Date(String(event.createdAt)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
                <div><strong>{String(event.action).replaceAll("_", " ")}</strong><p>{String(event.reason)}</p></div>
                <span className="audit-actor">{String(event.actor).replaceAll("_", " ")}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
