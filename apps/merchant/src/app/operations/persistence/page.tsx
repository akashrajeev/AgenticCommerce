import Link from "next/link";

export const dynamic = "force-dynamic";

const GATEWAY_URL = process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000";
const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);

type Transaction = { id: string; state: string; quote?: { totalPaise?: number }; updatedAt?: string; razorpayOrderId?: string; razorpayPaymentId?: string };
type MerchantOrdersResponse = { orders: Array<{ merchantOrderId: string; transactionId: string; amountPaise: number; incrementalRevenuePaise: number; createdAt: string }>; revenue: { confirmedOrders: number; realizedIncrementalRevenuePaise: number; upliftedOrders: number; persistence?: { source: string; hydratedAt: string | null; records: { transactions: number; auditEvents: number; merchantOrders: number } } } };

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${GATEWAY_URL}${path}`, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch { return null; }
}

export default async function PersistenceProofPage() {
  const [transactionsBody, ordersBody] = await Promise.all([
    getJson<{ transactions: Transaction[] }>("/v1/transactions"),
    getJson<MerchantOrdersResponse>("/v1/merchant/orders"),
  ]);
  const transactions = transactionsBody?.transactions ?? [];
  const orders = ordersBody?.orders ?? [];
  const persistence = ordersBody?.revenue.persistence;
  const latest = [...transactions].sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))).slice(0, 6);
  const databaseBacked = persistence?.source === "postgresql";

  return (
    <main style={{ minHeight: "100vh", background: "#f6f6f2", color: "#171717", fontFamily: "Arial, sans-serif", padding: "34px 20px 70px" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, marginBottom: 26 }}>
          <Link href="/operations" style={{ color: "#666", textDecoration: "none", fontSize: 12 }}>← Operations</Link>
          <span style={{ padding: "7px 10px", border: "1px solid #c9d8ce", background: "#eef6f0", color: "#1f5b3f", fontSize: 10, fontWeight: 700, letterSpacing: ".08em" }}>JUDGE PROOF · POSTGRESQL</span>
        </div>

        <div style={{ borderTop: "2px solid #171717", paddingTop: 18 }}>
          <div style={{ fontSize: 11, letterSpacing: ".12em", fontWeight: 700, color: "#777" }}>MANDATE / RESTART-SAFE STATE</div>
          <h1 style={{ fontSize: 48, letterSpacing: "-.05em", lineHeight: 1.03, margin: "10px 0 12px", maxWidth: 760 }}>A gateway restart must not erase the transaction.</h1>
          <p style={{ maxWidth: 760, color: "#666", lineHeight: 1.7, margin: 0 }}>This page reads the persisted transaction, audit and merchant-order stores through the running gateway. Create or confirm a transaction, restart only the gateway container, then refresh this page. The same IDs and revenue records should still be present.</p>
        </div>

        <section style={{ marginTop: 28, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div style={{ background: "white", border: "1px solid #dddcd7", padding: 20 }}>
            <div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>PERSISTENCE</div>
            <div style={{ fontSize: 26, fontWeight: 700, marginTop: 10 }}>{databaseBacked ? "PostgreSQL" : "Memory fallback"}</div>
            <div style={{ color: databaseBacked ? "#1f5b3f" : "#8d332d", marginTop: 6, fontSize: 12 }}>{databaseBacked ? "Database-backed runtime" : "DATABASE_URL not active"}</div>
          </div>
          <div style={{ background: "white", border: "1px solid #dddcd7", padding: 20 }}>
            <div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>TRANSACTIONS LOADED</div>
            <div style={{ fontSize: 26, fontWeight: 700, marginTop: 10 }}>{persistence?.records.transactions ?? transactions.length}</div>
            <div style={{ color: "#777", marginTop: 6, fontSize: 12 }}>Hydrated at {persistence?.hydratedAt ? new Date(persistence.hydratedAt).toLocaleTimeString() : "—"}</div>
          </div>
          <div style={{ background: "white", border: "1px solid #dddcd7", padding: 20 }}>
            <div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>AUDIT EVENTS LOADED</div>
            <div style={{ fontSize: 26, fontWeight: 700, marginTop: 10 }}>{persistence?.records.auditEvents ?? "—"}</div>
            <div style={{ color: "#777", marginTop: 6, fontSize: 12 }}>Order records {persistence?.records.merchantOrders ?? orders.length}</div>
          </div>
        </section>

        <section style={{ marginTop: 14, background: "#171717", color: "white", padding: 22 }}>
          <div style={{ fontSize: 11, color: "#bcbcb8", letterSpacing: ".1em", fontWeight: 700 }}>HOW TO DEMONSTRATE THIS</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 16 }}>
            {["Create a transaction", "Confirm payment/order", "docker compose restart gateway", "Refresh this page"].map((step, index) => <div key={step} style={{ border: "1px solid #3b3b39", padding: 14 }}><div style={{ fontSize: 10, color: "#9d9d99" }}>0{index + 1}</div><div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.45 }}>{step}</div></div>)}
          </div>
          <div style={{ marginTop: 16, fontSize: 12, color: "#c9c9c5", lineHeight: 1.6 }}>The important evidence is continuity: the transaction ID, payment references, policy result, audit count and realized revenue remain available after the gateway process is recreated.</div>
        </section>

        <section style={{ marginTop: 14, background: "white", border: "1px solid #dddcd7" }}>
          <div style={{ padding: 20, borderBottom: "1px solid #e6e5e0", display: "flex", justifyContent: "space-between", alignItems: "end", gap: 20 }}>
            <div><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>PERSISTED TRANSACTION CHECKPOINT</div><h2 style={{ margin: "7px 0 0", fontSize: 23, letterSpacing: "-.03em" }}>Latest records visible after restart</h2></div>
            <span style={{ color: "#777", fontSize: 11 }}>{latest.length} shown</span>
          </div>
          {latest.length ? latest.map((transaction) => <div key={transaction.id} style={{ display: "grid", gridTemplateColumns: "1.5fr .9fr .9fr 1fr", gap: 16, alignItems: "center", padding: "15px 20px", borderBottom: "1px solid #ecebe6" }}><code style={{ fontSize: 11 }}>{transaction.id}</code><span style={{ fontSize: 11, textTransform: "capitalize" }}>{transaction.state.replaceAll("_", " ")}</span><strong style={{ fontSize: 11 }}>{typeof transaction.quote?.totalPaise === "number" ? money(transaction.quote.totalPaise) : "—"}</strong><span style={{ color: "#666", fontSize: 10 }}>{transaction.razorpayPaymentId ?? "No payment yet"}</span></div>) : <div style={{ padding: 22, color: "#777", fontSize: 12 }}>No persisted transactions are visible yet. Run a checkout first.</div>}
        </section>

        <section style={{ marginTop: 14, background: "white", border: "1px solid #dddcd7" }}>
          <div style={{ padding: 20, borderBottom: "1px solid #e6e5e0" }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 700 }}>REALIZED MERCHANT REVENUE</div><h2 style={{ margin: "7px 0 0", fontSize: 23, letterSpacing: "-.03em" }}>Revenue records survive with the transaction</h2></div>
          <div style={{ padding: 20, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <div style={{ border: "1px solid #e6e5e0", padding: 15 }}><span style={{ color: "#777", fontSize: 10 }}>CONFIRMED ORDERS</span><strong style={{ display: "block", fontSize: 25, marginTop: 8 }}>{ordersBody?.revenue.confirmedOrders ?? 0}</strong></div>
            <div style={{ border: "1px solid #e6e5e0", padding: 15 }}><span style={{ color: "#777", fontSize: 10 }}>REALIZED INCREMENTAL</span><strong style={{ display: "block", fontSize: 25, marginTop: 8 }}>{money(ordersBody?.revenue.realizedIncrementalRevenuePaise ?? 0)}</strong></div>
            <div style={{ border: "1px solid #e6e5e0", padding: 15 }}><span style={{ color: "#777", fontSize: 10 }}>UPLIFTED ORDERS</span><strong style={{ display: "block", fontSize: 25, marginTop: 8 }}>{ordersBody?.revenue.upliftedOrders ?? 0}</strong></div>
          </div>
        </section>
      </div>
    </main>
  );
}
