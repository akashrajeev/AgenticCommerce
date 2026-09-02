"use client";

import { useMemo, useState } from "react";

const MERCHANT_URL = process.env.NEXT_PUBLIC_MERCHANT_URL ?? "http://localhost:3000";
const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4000";

const money = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);

type Product = {
  id: string;
  name: string;
  category: string;
  pricePaise: number;
  rating: number;
  inventory: number;
  shortDescription: string;
  features: string[];
  specifications: Record<string, string>;
};

type CatalogResponse = { products: Product[] };
type Quote = {
  quoteId: string;
  totalPaise: number;
  expiresAt: string;
  lineItems: Array<{ productId: string; quantity: number }>;
};
type Transaction = {
  id: string;
  state: string;
  intent: { productId: string; quantity: number; maxSpendPaise: number; reason: string };
  quote: Quote;
  policy?: { decision: "ALLOW" | "BLOCK"; checks: Array<{ rule: string; result: "PASS" | "FAIL"; observed: string; expected: string; reason: string }> };
};

function parseRequest(text: string, catalog: Product[], maxSpendPaise: number) {
  const lower = text.toLowerCase();
  const category = lower.includes("keyboard")
    ? "keyboards"
    : lower.includes("mouse")
      ? "mice"
      : lower.includes("monitor")
        ? "monitors"
        : lower.includes("webcam")
          ? "webcams"
          : lower.includes("watch")
            ? "smartwatches"
            : "headphones";

  const candidates = catalog.filter((product) => product.category === category && product.inventory > 0);
  const ancRequired = lower.includes("anc") || lower.includes("noise cancellation");
  const filtered = candidates.filter((product) => !ancRequired || product.features.some((feature) => feature.toLowerCase().includes("noise cancellation")));
  const affordable = filtered.filter((product) => product.pricePaise <= maxSpendPaise);
  const pool = affordable.length > 0 ? affordable : filtered.length > 0 ? filtered : candidates;

  return [...pool].sort((a, b) => {
    if (a.pricePaise !== b.pricePaise && lower.includes("under")) return a.pricePaise - b.pricePaise;
    return b.rating - a.rating;
  })[0];
}

export default function BuyerWorkspace() {
  const [request, setRequest] = useState("Buy the best ANC headphones under ₹5,000");
  const [maxSpend, setMaxSpend] = useState(5000);
  const [product, setProduct] = useState<Product | null>(null);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [stage, setStage] = useState("ready");
  const [error, setError] = useState("");
  const [activity, setActivity] = useState<string[]>([]);

  const selectedAmount = transaction?.quote.totalPaise ?? product?.pricePaise ?? 0;
  const remaining = Math.max(maxSpend * 100 - selectedAmount, 0);

  const statusLabel = useMemo(() => {
    if (stage === "blocked") return "Blocked";
    if (stage === "authorized") return "Authorized";
    if (stage === "working") return "Evaluating";
    return "Ready";
  }, [stage]);

  async function runAgent() {
    setError("");
    setTransaction(null);
    setActivity([]);
    setProduct(null);
    setStage("working");

    try {
      setActivity(["Reading your constraints", "Discovering Mandate Market"]);
      const catalogResponse = await fetch(`${MERCHANT_URL}/api/agent/catalog`, { cache: "no-store" });
      if (!catalogResponse.ok) throw new Error("Unable to read merchant catalog.");
      const catalogBody = (await catalogResponse.json()) as CatalogResponse;
      const chosen = parseRequest(request, catalogBody.products, maxSpend * 100);
      if (!chosen) throw new Error("No qualifying product was found.");

      setProduct(chosen);
      setActivity((current) => [...current, `${catalogBody.products.length} products evaluated`, `${chosen.name} selected`]);

      const quoteResponse = await fetch(`${MERCHANT_URL}/api/agent/checkout/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId: chosen.id, quantity: 1 }),
      });
      if (!quoteResponse.ok) throw new Error("Merchant could not produce a checkout quote.");
      const quoteBody = (await quoteResponse.json()) as { quote: Quote };

      setActivity((current) => [...current, "Checkout quote verified"]);
      const transactionResponse = await fetch(`${GATEWAY_URL}/v1/purchase-intents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          merchantId: "mandate-market",
          productId: chosen.id,
          quantity: 1,
          maxSpendPaise: maxSpend * 100,
          reason: request,
          quoteId: quoteBody.quote.quoteId,
        }),
      });

      const transactionBody = (await transactionResponse.json()) as { transaction?: Transaction; error?: string };
      if (!transactionResponse.ok || !transactionBody.transaction) {
        throw new Error(transactionBody.error ?? "Gateway rejected the purchase intent.");
      }

      setTransaction(transactionBody.transaction);
      if (transactionBody.transaction.state === "policy_authorized") {
        setActivity((current) => [...current, "Policy approved the transaction"]);
        setStage("authorized");
      } else {
        setActivity((current) => [...current, "Policy blocked the transaction"]);
        setStage("blocked");
      }
    } catch (caught) {
      setStage("ready");
      setError(caught instanceof Error ? caught.message : "The agent could not complete the request.");
    }
  }

  return (
    <main className="buyer-shell">
      <header className="buyer-header">
        <div className="brand"><span className="brand-mark">M</span><span>MANDATE</span></div>
        <div className="header-right"><span className="live-dot" /> Agent runtime <span className="divider" /> Test environment</div>
      </header>

      <section className="buyer-grid">
        <section className="request-column">
          <div className="section-kicker">AI BUYER</div>
          <h1>Purchase workspace</h1>
          <p className="lede">Give the buyer a goal and a hard spending boundary. It handles discovery and checkout preparation; the gateway controls authorization.</p>

          <label className="field-label" htmlFor="request">Request</label>
          <textarea id="request" value={request} onChange={(event) => setRequest(event.target.value)} />

          <div className="limit-row">
            <div>
              <label className="field-label" htmlFor="limit">Maximum spend</label>
              <div className="currency-input"><span>₹</span><input id="limit" type="number" min={0} step={100} value={maxSpend} onChange={(event) => setMaxSpend(Number(event.target.value) || 0)} /></div>
            </div>
            <div className="policy-note"><strong>Hard limit</strong><span>Cannot be changed by the agent.</span></div>
          </div>

          <button className="run-button" onClick={() => void runAgent()} disabled={stage === "working" || !request.trim()}>
            {stage === "working" ? "Evaluating…" : "Evaluate purchase"}
            <span>→</span>
          </button>

          {error ? <div className="error-box">{error}</div> : null}

          <div className="workspace-footer">
            <span>Merchant: Mandate Market</span>
            <span>Payment rail: Razorpay Test Mode</span>
          </div>
        </section>

        <section className="decision-column">
          <div className="decision-header">
            <div><span className={`status status-${stage}`}>{statusLabel}</span><span className="decision-label">Current decision</span></div>
            {transaction ? <code>{transaction.id}</code> : <span className="quiet">No transaction yet</span>}
          </div>

          <div className="product-panel">
            <span className="panel-kicker">SELECTED PRODUCT</span>
            {product ? (
              <>
                <div className="product-main">
                  <div>
                    <h2>{product.name}</h2>
                    <p>{product.shortDescription}</p>
                  </div>
                  <strong>{money(selectedAmount)}</strong>
                </div>
                <div className="feature-list">
                  {product.features.slice(0, 4).map((feature) => <span key={feature}>✓ {feature}</span>)}
                </div>
              </>
            ) : (
              <div className="empty-selection"><span>—</span><p>Run the buyer to see a live product decision.</p></div>
            )}
          </div>

          <div className="policy-panel">
            <div className="panel-heading"><span className="panel-kicker">POLICY</span><span>{remaining ? `${money(remaining)} remaining` : selectedAmount ? "Limit reached" : "Awaiting evaluation"}</span></div>
            <div className="policy-grid">
              <div><span>Maximum spend</span><strong>{money(maxSpend * 100)}</strong></div>
              <div><span>Transaction</span><strong>{selectedAmount ? money(selectedAmount) : "—"}</strong></div>
            </div>
            <div className="check-list">
              {transaction?.policy?.checks.map((check) => (
                <div className="check-row" key={check.rule}><span className={`check ${check.result === "PASS" ? "pass" : "fail"}`}>{check.result === "PASS" ? "✓" : "×"}</span><div><strong>{check.rule.replaceAll("_", " ")}</strong><small>{check.reason}</small></div><code>{check.observed}</code></div>
              )) ?? <div className="check-placeholder">Policy checks appear here after gateway revalidation.</div>}
            </div>
          </div>

          <div className="activity-panel">
            <div className="panel-heading"><span className="panel-kicker">ACTIVITY</span><span>Application events</span></div>
            <div className="timeline">
              {(activity.length ? activity : ["Waiting for a request"]).map((item, index) => <div className="timeline-row" key={`${item}-${index}`}><span className={`timeline-dot ${activity.length ? "done" : ""}`} /><span>{item}</span></div>)}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
