import Link from "next/link";
import { catalog } from "../lib/catalog";

const formatINR = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);

export default function MerchantHomePage() {
  return (
    <main>
      <header className="site-header">
        <div className="header-inner">
          <Link href="/" className="brand" aria-label="Mandate Market home">
            <span className="brand-mark">M</span>
            <span>Mandate Market</span>
          </Link>
          <nav className="nav" aria-label="Primary navigation">
            <a href="#shop">Shop</a>
            <a href="#agent-commerce">For agents</a>
            <a href="#operations">Operations</a>
          </nav>
          <div className="header-actions">
            <span className="mode-pill">Razorpay Test Mode</span>
            <button className="icon-button" aria-label="Search products">⌕</button>
          </div>
        </div>
      </header>

      <section className="store-hero">
        <div className="hero-copy">
          <p className="eyebrow">Independent commerce · agent-ready</p>
          <h1>Products selected<br />for the way you work.</h1>
          <p className="hero-description">
            A focused catalog of work, creator and everyday tech. Mandate Market exposes the same
            structured inventory to people and authorized AI buyers.
          </p>
          <div className="hero-actions">
            <a href="#shop" className="button button-primary">Shop the catalog</a>
            <a href="#agent-commerce" className="button button-secondary">Explore agent access</a>
          </div>
        </div>
        <div className="hero-note" aria-label="Agent commerce status">
          <div className="note-topline"><span className="status-dot" /> Agent commerce online</div>
          <strong>Machine-readable catalog</strong>
          <p>Live inventory, prices and checkout quotes are available through the merchant API.</p>
          <code>/.well-known/agent-commerce</code>
        </div>
      </section>

      <section id="shop" className="catalog-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">The catalog</p>
            <h2>Popular this week</h2>
          </div>
          <span className="count-label">{catalog.length} products</span>
        </div>

        <div className="product-grid">
          {catalog.map((product) => (
            <article className="product-card" key={product.id}>
              <div className="product-visual" data-category={product.category}>
                <span>{product.category.replaceAll("-", " ")}</span>
                <span className="product-sku">{product.sku}</span>
              </div>
              <div className="product-info">
                <div className="product-title-row">
                  <h3>{product.name}</h3>
                  <span className="rating">★ {product.rating}</span>
                </div>
                <p>{product.shortDescription}</p>
                <div className="product-meta">
                  <strong>{formatINR(product.pricePaise)}</strong>
                  <span>{product.inventory} in stock</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="agent-commerce" className="agent-section">
        <div>
          <p className="eyebrow">Built for agents</p>
          <h2>A merchant an AI buyer can actually transact with.</h2>
          <p>
            The catalog is not hidden behind a browser. Agents can discover capabilities, inspect
            structured products, verify inventory and request a deterministic checkout quote.
          </p>
        </div>
        <div className="agent-contract">
          <div className="contract-row"><span>Catalog</span><strong>GET /api/agent/catalog</strong></div>
          <div className="contract-row"><span>Inventory</span><strong>GET /api/agent/inventory/:id</strong></div>
          <div className="contract-row"><span>Quote</span><strong>POST /api/agent/checkout/preview</strong></div>
          <div className="contract-row"><span>Payment</span><strong>Razorpay · Test Mode</strong></div>
        </div>
      </section>

      <section id="operations" className="ops-strip">
        <div>
          <span className="ops-number">14</span>
          <span>transactions awaiting review</span>
        </div>
        <div>
          <span className="ops-number">99.8%</span>
          <span>inventory accuracy</span>
        </div>
        <div>
          <span className="ops-number">₹2.4L</span>
          <span>gross merchandise value</span>
        </div>
      </section>

      <footer className="site-footer">
        <span>Mandate Market · Merchant reference application</span>
        <span>Payments powered by Razorpay Test Mode</span>
      </footer>
    </main>
  );
}
