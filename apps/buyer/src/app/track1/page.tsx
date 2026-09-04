import Link from "next/link";

export const dynamic = "force-dynamic";

const GATEWAY = (process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");
const MERCHANT = (process.env.MERCHANT_INTERNAL_URL ?? "http://localhost:3000").replace(/\/$/, "");
const MCP = (process.env.MCP_INTERNAL_URL ?? "http://localhost:4100").replace(/\/$/, "");
const X402 = (process.env.X402_SERVICE_INTERNAL_URL ?? process.env.X402_INTERNAL_URL ?? "http://localhost:4021").replace(/\/$/, "");
const GATEWAY_SECRET = process.env.INTERNAL_GATEWAY_SECRET ?? "";
const MCP_TOKEN = process.env.MCP_AGENT_TOKEN ?? "";

type Check = { ok: boolean; label: string; detail: string };

async function readJson(url: string, init: RequestInit = {}): Promise<any | null> {
  try {
    const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(5000) });
    const body = await response.json().catch(() => null);
    return { response, body };
  } catch {
    return null;
  }
}

async function razorpayCheck(): Promise<Check> {
  if (!GATEWAY_SECRET) return { ok: false, label: "Razorpay Test Mode", detail: "INTERNAL_GATEWAY_SECRET not configured" };
  const result = await readJson(`${GATEWAY}/v1/internal/razorpay/status?deep=1`, { headers: { "x-mandate-gateway-secret": GATEWAY_SECRET } });
  const body = result?.body as any;
  const ok = Boolean(result?.response?.ok && body?.testMode === true && body?.probe?.testMode === true);
  return { ok, label: "Razorpay Test Mode", detail: ok ? "Live credential probe passed · Test Mode" : "Not proven as Test Mode" };
}

async function gatewayCheck(): Promise<Check> {
  const result = await readJson(`${GATEWAY}/health`);
  return { ok: Boolean(result?.response?.ok), label: "MANDATE gateway", detail: result?.body?.status === "ok" ? "Gateway reachable" : "Gateway unavailable" };
}

async function merchantCheck(): Promise<Check> {
  const result = await readJson(`${MERCHANT}/api/agent/capabilities`);
  const ok = Boolean(result?.response?.ok && result?.body);
  return { ok, label: "Merchant agent", detail: ok ? "Capabilities discoverable" : "Capability endpoint unavailable" };
}

async function mcpCheck(): Promise<Check> {
  if (!MCP_TOKEN) return { ok: false, label: "MCP payment tools", detail: "MCP_AGENT_TOKEN not configured" };
  const headers = { "content-type": "application/json", authorization: `Bearer ${MCP_TOKEN}`, "mcp-protocol-version": "2026-07-28", "mcp-method": "server/discover" };
  const result = await readJson(`${MCP}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: "track1-discover", method: "server/discover" }) });
  const ok = Boolean(result?.response?.ok && result?.body?.result?.protocolVersion === "2026-07-28");
  return { ok, label: "MCP policy facade", detail: ok ? "Stateless MCP live · MANDATE guarded" : "MCP unavailable" };
}

async function x402Check(): Promise<Check> {
  const result = await readJson(`${X402}/health`);
  const body = result?.body as any;
  const ok = Boolean(result?.response?.ok && body?.configured === true && body?.network === "eip155:84532");
  return { ok, label: "x402 testnet", detail: ok ? "Base Sepolia service + facilitator configured" : "Testnet facilitator/payment receiver not fully configured" };
}

async function metrics(): Promise<{ confirmed: number; testModeOrders: number; upliftPaise: number }> {
  const result = await readJson(`${GATEWAY}/v1/merchant/orders`);
  const orders = Array.isArray(result?.body?.orders) ? result.body.orders : [];
  return {
    confirmed: orders.length,
    testModeOrders: orders.filter((order: any) => Boolean(order?.razorpayOrderId && order?.razorpayPaymentId)).length,
    upliftPaise: orders.reduce((sum: number, order: any) => sum + (typeof order?.incrementalRevenuePaise === "number" ? order.incrementalRevenuePaise : 0), 0),
  };
}

export default async function Track1CommandCenter() {
  const [gateway, merchant, razorpay, mcp, x402, stats] = await Promise.all([gatewayCheck(), merchantCheck(), razorpayCheck(), mcpCheck(), x402Check(), metrics()]);
  const checks = [gateway, merchant, razorpay, mcp, x402];
  const verifiedCount = checks.filter((check) => check.ok).length;
  const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
  const judgeFlow = [["01", "Discover", "/capabilities", "Merchant capability handshake"], ["02", "Negotiate", "/negotiation", "Buyer ↔ merchant agent"], ["03", "Authorize", "/delegated-mandates", "Bound autonomous spending"], ["04", "Pay", "/mcp/authorized", "MCP → MANDATE → Razorpay Test Mode"], ["05", "Measure", "/growth", "Verified merchant uplift"]] as const;
  const prioritySurfaces = [["Growth", "/growth", "Realized Test Mode uplift"], ["MCP proof", "/mcp/authorized", "Unauthorized vs authorized"], ["x402", "/x402", "Facilitator /verify → /settle"], ["Protocols", "/protocols", "Live capability/protocol probes"]] as const;

  return (
    <main style={{ minHeight: "100vh", background: "#f4f1eb", color: "#171717", fontFamily: "Arial, Helvetica, sans-serif", padding: "34px 20px 70px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 24, alignItems: "end", borderBottom: "1px solid #d8d1c6", paddingBottom: 20 }}>
          <div><div style={{ fontSize: 11, letterSpacing: ".15em", fontWeight: 800, color: "#8f7c65" }}>RAZORPAY TRACK 01 · MANDATE</div><h1 style={{ fontSize: 56, lineHeight: .95, letterSpacing: "-.055em", margin: "10px 0" }}>Agentic commerce,<br /><em style={{ fontStyle: "normal", color: "#8f7c65" }}>with the money boundary intact.</em></h1><p style={{ maxWidth: 780, color: "#635d55", lineHeight: 1.7, fontSize: 16, margin: 0 }}>One judge-facing control room for the real buyer, merchant, MANDATE policy layer and payment evidence. Payment claims stay grounded in configured Razorpay Test Mode state.</p></div>
          <div style={{ display: "grid", gap: 8, minWidth: 190 }}><Status value={`${verifiedCount}/${checks.length}`} label="live prerequisites" /><Status value={String(stats.confirmed)} label="confirmed merchant orders" /><Status value={money(stats.upliftPaise)} label="persisted incremental uplift" /></div>
        </header>

        <section style={{ marginTop: 22, display: "grid", gridTemplateColumns: "1.15fr .85fr", gap: 16 }}>
          <section style={{ background: "#fffdf8", border: "1px solid #ddd6ca", borderRadius: 18, padding: 22 }}><div style={{ fontSize: 10, letterSpacing: ".12em", fontWeight: 800, color: "#777" }}>LIVE SYSTEM PROOF</div><h2 style={{ fontSize: 25, margin: "7px 0 18px" }}>Runtime truth, not mock status.</h2><div style={{ display: "grid", gap: 9 }}>{checks.map((check) => <div key={check.label} style={{ display: "grid", gridTemplateColumns: "12px 1fr auto", gap: 10, alignItems: "center", padding: "11px 0", borderBottom: "1px solid #ece6dc" }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: check.ok ? "#1e5b3e" : "#a65b4f" }} /><div><strong style={{ display: "block", fontSize: 13 }}>{check.label}</strong><span style={{ color: "#777", fontSize: 11 }}>{check.detail}</span></div><b style={{ fontSize: 10, letterSpacing: ".08em", color: check.ok ? "#1e5b3e" : "#a65b4f" }}>{check.ok ? "LIVE" : "BLOCKED"}</b></div>)}</div></section>

          <section style={{ background: "#171717", color: "white", borderRadius: 18, padding: 22 }}><div style={{ fontSize: 10, letterSpacing: ".12em", fontWeight: 800, color: "#aaa" }}>THE JUDGE FLOW</div><div style={{ display: "grid", gap: 10, marginTop: 15 }}>{judgeFlow.map(([n, title, href, detail]) => <Link key={n} href={href} style={{ display: "grid", gridTemplateColumns: "30px 1fr auto", gap: 11, alignItems: "center", color: "white", textDecoration: "none", border: "1px solid #393939", padding: 13, borderRadius: 12 }}><span style={{ color: "#999", fontFamily: "monospace", fontSize: 10 }}>{n}</span><div><strong style={{ display: "block", fontSize: 12 }}>{title}</strong><span style={{ display: "block", color: "#aaa", marginTop: 3, fontSize: 10 }}>{detail}</span></div><span style={{ color: "#c7c1b7" }}>→</span></Link>)}</div></section>
        </section>

        <section style={{ marginTop: 16, background: "#fffdf8", border: "1px solid #ddd6ca", borderRadius: 18, padding: 22 }}><div style={{ fontSize: 10, letterSpacing: ".12em", fontWeight: 800, color: "#777" }}>PRIORITY SURFACES</div><div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 14 }}>{prioritySurfaces.map(([title, href, detail]) => <Link key={title} href={href} style={{ textDecoration: "none", color: "inherit", border: "1px solid #e2dcd2", padding: 16, borderRadius: 14 }}><strong style={{ fontSize: 15 }}>{title}</strong><span style={{ display: "block", color: "#6f665d", fontSize: 11, lineHeight: 1.45, marginTop: 6 }}>{detail}</span><span style={{ display: "block", marginTop: 13, fontSize: 11, fontWeight: 800 }}>Open →</span></Link>)}</div></section>

        <section style={{ marginTop: 16, background: "#171717", color: "white", borderRadius: 18, padding: 22 }}><div style={{ fontSize: 10, color: "#aaa", letterSpacing: ".12em", fontWeight: 800 }}>NON-NEGOTIABLE PAYMENT RULE</div><div style={{ fontSize: 22, fontWeight: 800, marginTop: 7 }}>The agent may decide. It may never become the financial authority.</div><p style={{ maxWidth: 880, color: "#bbb", lineHeight: 1.6, fontSize: 12 }}>Merchant quote → signed mandate → deterministic policy → Razorpay Test Mode. Protocol choice, model output and campaign recommendation stay upstream of the trusted payment boundary.</p></section>
      </div>
    </main>
  );
}

function Status({ value, label }: { value: string; label: string }) {
  return <div style={{ background: "#fffdf8", border: "1px solid #ddd6ca", padding: 13, borderRadius: 12 }}><strong style={{ display: "block", fontSize: 24, letterSpacing: "-.03em" }}>{value}</strong><span style={{ color: "#776f64", fontSize: 9, letterSpacing: ".08em" }}>{label.toUpperCase()}</span></div>;
}
