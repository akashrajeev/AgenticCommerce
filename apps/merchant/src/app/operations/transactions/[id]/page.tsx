import Link from "next/link";
import styles from "./page.module.css";
import { getMerchantOrderByTransaction } from "../../../../lib/orders";

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

  const intent = transaction.intent as { reason?: string; productId?: string; quantity?: number; maxSpendPaise?: number; lineItems?: Array<{ productId?: string; quantity?: number }> };
  const quote = transaction.quote as { totalPaise?: number; currency?: string; lineItems?: Array<{ productId: string; quantity: number; unitPricePaise?: number; lineTotalPaise?: number }> };
  const policy = transaction.policy as { decision?: string; checks?: Array<Record<string, unknown>> } | undefined;
  const basketLines = quote.lineItems?.length ? quote.lineItems : intent.lineItems?.length ? intent.lineItems : intent.productId ? [{ productId: intent.productId, quantity: intent.quantity ?? 1 }] : [];
  const webhookEvents = events.filter((event) => String(event.action).startsWith("WEBHOOK_"));
  const captured = transaction.state === "payment_captured" || transaction.state === "payment_verified" || transaction.state === "order_confirmed";
  const merchantOrder = transaction.state === "order_confirmed" ? getMerchantOrderByTransaction(id) : undefined;
  const basketLift = merchantOrder?.incrementalRevenuePaise ?? 0;

  return (
    <main className="ops-page">
      <header className="ops-header">
        <Link href="/" className="brand"><span className="brand-mark">M</span><span>Mandate Market</span></Link>
        <div className="ops-nav"><Link href="/operations">Transactions</Link><span className="mode-pill">Razorpay Test Mode</span></div>
      </header>

      <div className={`ops-container ${styles.page}`}>
        <Link href="/operations" className={styles.back}>← All transactions</Link>
        <div className={styles.title}>
          <div><p className="eyebrow">Transaction detail</p><h1>{id}</h1></div>
          <span className={styles.state}>{String(transaction.state).replaceAll("_", " ")}</span>
        </div>

        <section className={styles.grid}>
          <div className={`${styles.card} ${styles.wide}`}>
            <p className="eyebrow">Purchase intent</p>
            <h2>{intent.reason ?? "—"}</h2>
            <div className={styles.facts}>
              <div className={styles.fact}><span>Primary product</span><strong>{intent.productId ?? "—"}</strong></div>
              <div className={styles.fact}><span>Basket lines</span><strong>{basketLines.length}</strong></div>
              <div className={styles.fact}><span>Maximum spend</span><strong>{typeof intent.maxSpendPaise === "number" ? money(intent.maxSpendPaise) : "—"}</strong></div>
              <div className={styles.fact}><span>Final quote</span><strong>{typeof quote.totalPaise === "number" ? money(quote.totalPaise) : "—"}</strong></div>
            </div>
          </div>

          <div className={styles.card}>
            <p className="eyebrow">Razorpay payment rail</p>
            <dl className={styles.refList}>
              <div><dt>Order</dt><dd>{String(transaction.razorpayOrderId ?? "Not created")}</dd></div>
              <div><dt>Payment</dt><dd>{String(transaction.razorpayPaymentId ?? "Not received")}</dd></div>
              <div><dt>Captured</dt><dd>{captured ? "Yes" : "No"}</dd></div>
              <div><dt>Webhook evidence</dt><dd>{webhookEvents.length ? `${webhookEvents.length} event${webhookEvents.length === 1 ? "" : "s"}` : "Awaiting webhook"}</dd></div>
            </dl>
          </div>

          <div className={styles.card}>
            <p className="eyebrow">Policy decision</p>
            <div className={`${styles.banner} ${policy?.decision === "BLOCK" ? styles.blocked : styles.allowed}`}>{policy?.decision ?? "PENDING"}</div>
            <div className={styles.checks}>{policy?.checks?.map((check) => <div className={styles.check} key={String(check.rule)}><span>{String(check.result)}</span><strong>{String(check.rule).replaceAll("_", " ")}</strong></div>) ?? <span>Awaiting evaluation.</span>}</div>
          </div>
        </section>

        {basketLines.length > 1 ? (
          <section className={styles.card}>
            <div className={styles.auditHeader}><div><p className="eyebrow">Approved basket</p><h2>Revenue expansion</h2></div><span>{basketLift > 0 ? `+${money(basketLift)} realized` : "No realized uplift"}</span></div>
            <div className={styles.facts}>
              {basketLines.map((line) => <div className={styles.fact} key={String(line.productId)}><span>{String(line.productId)}</span><strong>× {line.quantity}</strong></div>)}
            </div>
            <p className="eyebrow">Additional lines are included only after user approval and the gateway re-evaluates the combined quote.</p>
          </section>
        ) : null}

        <section className={`${styles.card} ${styles.audit}`}>
          <div className={styles.auditHeader}><div><p className="eyebrow">Audit trail</p><h2>Every transition, recorded.</h2></div><span>{events.length} events</span></div>
          <div className={styles.auditRows}>
            {events.map((event) => <div className={styles.auditRow} key={String(event.id)}><div className={styles.auditTime}>{new Date(String(event.createdAt)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div><div><strong>{String(event.action).replaceAll("_", " ")}</strong><p>{String(event.reason)}</p></div><span className={styles.auditActor}>{String(event.actor).replaceAll("_", " ")}</span></div>)}
          </div>
        </section>
      </div>
    </main>
  );
}
