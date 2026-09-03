"use client";

import { useState } from "react";

type X402Result = { status?: number; paymentRequired?: string | null; paymentResponse?: string | null; body?: Record<string, unknown> | null } | null;
type WalletProvider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

declare global { interface Window { ethereum?: WalletProvider } }

const BASE_SEPOLIA_CHAIN_ID = "0x14a34";
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

function decodeBase64Json(value: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.charCodeAt(0)))) as Record<string, unknown>;
}

function randomBytes32(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export default function X402Page() {
  const [health, setHealth] = useState<X402Result>(null);
  const [challenge, setChallenge] = useState<X402Result>(null);
  const [facilitator, setFacilitator] = useState<X402Result>(null);
  const [proof, setProof] = useState<X402Result>(null);
  const [settlement, setSettlement] = useState<X402Result>(null);
  const [wallet, setWallet] = useState("");
  const [busy, setBusy] = useState("");

  async function run(action: string, setter: (value: X402Result) => void) {
    setBusy(action);
    try {
      const response = await fetch("/api/x402-lab", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }), cache: "no-store" });
      setter(await response.json() as X402Result);
    } catch (error) {
      setter({ status: 502, body: { error: error instanceof Error ? error.message : "X402_LAB_FAILED" } });
    } finally { setBusy(""); }
  }

  async function connectWallet() {
    if (!window.ethereum) { setSettlement({ status: 400, body: { error: "NO_EVM_WALLET_DETECTED" } }); return; }
    setBusy("wallet");
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      const account = accounts?.[0];
      if (!account) throw new Error("NO_WALLET_ACCOUNT");
      try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_SEPOLIA_CHAIN_ID }] }); }
      catch (error) {
        if ((error as { code?: number })?.code !== 4902) throw error;
        await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: BASE_SEPOLIA_CHAIN_ID, chainName: "Base Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://sepolia.base.org"], blockExplorerUrls: ["https://sepolia.basescan.org"] }] });
      }
      setWallet(account);
      await run("challenge", setChallenge);
    } catch (error) { setSettlement({ status: 400, body: { error: error instanceof Error ? error.message : "WALLET_CONNECTION_FAILED" } }); }
    finally { setBusy(""); }
  }

  async function signAndSettle() {
    if (!window.ethereum) { setSettlement({ status: 400, body: { error: "NO_EVM_WALLET_DETECTED" } }); return; }
    setBusy("settle");
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      const account = accounts?.[0] ?? wallet;
      if (!account) throw new Error("CONNECT_WALLET_FIRST");
      const response = await fetch("/api/x402-lab", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "challenge" }), cache: "no-store" });
      const result = await response.json() as X402Result;
      setChallenge(result);
      if (result?.status !== 402 || !result.paymentRequired) throw new Error("X402_CHALLENGE_UNAVAILABLE_CONFIGURE_X402_PAY_TO");

      const required = decodeBase64Json(result.paymentRequired);
      const accepts = Array.isArray(required.accepts) ? required.accepts as Array<Record<string, unknown>> : [];
      const accepted = accepts.find((item) => item.scheme === "exact" && typeof item.network === "string" && item.network.startsWith("eip155:"));
      if (!accepted) throw new Error("NO_EVM_EXACT_PAYMENT_OPTION");
      const chainId = Number.parseInt(String(accepted.network).split(":")[1] ?? "", 10);
      if (chainId !== 84532) throw new Error("JUDGE_FLOW_REQUIRES_BASE_SEPOLIA");

      const extra = accepted.extra && typeof accepted.extra === "object" ? accepted.extra as Record<string, unknown> : {};
      const now = Math.floor(Date.now() / 1000);
      const authorization = {
        from: account,
        to: String(accepted.payTo),
        value: String(accepted.amount),
        validAfter: String(now - 60),
        validBefore: String(now + Number(accepted.maxTimeoutSeconds ?? 60)),
        nonce: randomBytes32(),
      };
      const typedData = {
        types: {
          EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
          TransferWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }],
        },
        primaryType: "TransferWithAuthorization",
        domain: { name: String(extra.name ?? "USDC"), version: String(extra.version ?? "2"), chainId, verifyingContract: String(accepted.asset) },
        message: authorization,
      };
      const signature = await window.ethereum.request({ method: "eth_signTypedData_v4", params: [account, JSON.stringify(typedData)] }) as string;
      const paymentPayload = { x402Version: 2, resource: required.resource, accepted, payload: { signature, authorization }, extensions: {} };
      const settleResponse = await fetch("/api/x402-lab", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "live-settle", paymentPayload }), cache: "no-store" });
      const settleResult = await settleResponse.json() as X402Result;
      setSettlement(settleResult);
      setWallet(account);
      await run("proof", setProof);
    } catch (error) { setSettlement({ status: 400, body: { error: error instanceof Error ? error.message : "X402_SETTLEMENT_FAILED" } }); }
    finally { setBusy(""); }
  }

  const body = settlement?.body;
  const tx = typeof body?.transaction === "string" ? body.transaction : null;
  const settled = settlement?.status === 200 && Boolean(tx);

  return <main style={{ minHeight: "100vh", background: "#f3f4f2", color: "#171717", padding: 36, fontFamily: "Inter, Arial, sans-serif" }}><div style={{ maxWidth: 1120, margin: "0 auto" }}>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "end", marginBottom: 30 }}><div><div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: "#666" }}>PHASE 10 / X402 AGENT-TO-SERVICE</div><h1 style={{ fontSize: 46, lineHeight: 1.03, margin: "8px 0 12px" }}>Pay for a service over HTTP. Keep authority in MANDATE.</h1><p style={{ maxWidth: 800, fontSize: 17, lineHeight: 1.5, color: "#555" }}>x402 carries payment over HTTP. MANDATE adds a signed service authorization, while the browser wallet signs the actual EIP-3009 payment. The facilitator verifies and settles the signed payment on Base Sepolia.</p></div><a href="/" style={{ fontWeight: 700, color: "#171717" }}>Buyer workspace →</a></header>

    <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}><div style={{ background: "white", border: "1px solid #ddd", borderRadius: 18, padding: 24 }}><div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.5, color: "#666" }}>PROTOCOL TRACE</div><div style={{ marginTop: 18, display: "grid", gap: 14 }}><Step n="01" title="Client asks for protected resource" detail="GET /resource" /><Step n="02" title="Service returns HTTP 402" detail="PAYMENT-REQUIRED = Base64(JSON PaymentRequired v2)" /><Step n="03" title="Browser wallet signs exact payment" detail="EIP-712 TransferWithAuthorization → PAYMENT-SIGNATURE" /><Step n="04" title="MANDATE service authorization is added" detail="Signed, scoped, time-bound demo credential" /><Step n="05" title="Facilitator verifies and settles" detail="/verify → /settle → onchain transaction hash → PAYMENT-RESPONSE" /></div><div style={{ marginTop: 22, padding: 16, background: "#171717", color: "white", borderRadius: 14 }}><strong>Trust rule</strong><div style={{ color: "#bbb", marginTop: 6 }}>The wallet authorizes the money movement; MANDATE authorizes whether the agent may request that payment.</div></div></div>

    <div style={{ display: "grid", gap: 18 }}><ActionCard title="1. Check x402 service" detail="Shows network, pay-to configuration, facilitator configuration and demo-credential status." result={health} busy={busy === "health"} onClick={() => void run("health", setHealth)} /><ActionCard title="2. Probe live facilitator" detail="Calls GET /supported on the configured facilitator and displays advertised payment kinds." result={facilitator} busy={busy === "facilitator"} onClick={() => void run("facilitator", setFacilitator)} /><ActionCard title="3. Request the paid resource" detail="Expected: HTTP 402 with a standards-shaped PAYMENT-REQUIRED header." result={challenge} busy={busy === "challenge"} onClick={() => void run("challenge", setChallenge)} /><div style={{ background: "#171717", color: "white", borderRadius: 18, padding: 22 }}><div style={{ fontSize: 11, letterSpacing: 1.4, fontWeight: 700, color: "#aaa" }}>LIVE TESTNET SETTLEMENT</div><div style={{ fontSize: 23, fontWeight: 800, marginTop: 5 }}>{settled ? "SETTLED ON BASE SEPOLIA" : wallet ? "WALLET CONNECTED" : "CONNECT A TESTNET WALLET"}</div><div style={{ marginTop: 8, color: "#bbb", lineHeight: 1.45 }}>{wallet ? `Wallet: ${wallet.slice(0, 8)}…${wallet.slice(-6)}` : "No private key is handled by the app. The wallet signs in the browser."}</div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}><button disabled={!!busy} onClick={() => void connectWallet()} style={buttonStyle("light")}>{busy === "wallet" ? "Connecting…" : "Connect wallet"}</button><button disabled={!!busy || !wallet} onClick={() => void signAndSettle()} style={buttonStyle("mint")}>{busy === "settle" ? "Settling…" : "Sign & settle"}</button></div>{settlement && <pre style={{ marginTop: 14, background: "#232323", color: "#ddd", padding: 12, overflow: "auto", maxHeight: 240, fontSize: 11 }}>{pretty(settlement)}</pre>}{settled ? <a href={`https://sepolia.basescan.org/tx/${tx}`} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 12, color: "white", fontWeight: 800 }}>Open settlement transaction on BaseScan →</a> : null}</div></div></section>

    <section style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}><div style={{ background: "white", border: "1px solid #ddd", borderRadius: 18, padding: 22 }}><div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: "#666" }}>LATEST PROOF</div><p style={{ color: "#555", fontSize: 13, lineHeight: 1.6 }}>The x402 service records the latest successful settlement response in memory so the judge can verify the exact facilitator transaction after the live run.</p><button disabled={!!busy} onClick={() => void run("proof", setProof)} style={{ padding: "10px 12px", border: "1px solid #ccc", background: "#fafafa", borderRadius: 10, fontWeight: 800, cursor: "pointer" }}>Refresh settlement proof</button>{proof && <pre style={{ marginTop: 12, background: "#f7f7f5", padding: 12, overflow: "auto", maxHeight: 240, fontSize: 11 }}>{pretty(proof)}</pre>}</div><div style={{ background: "white", border: "1px solid #ddd", borderRadius: 18, padding: 22 }}><div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: "#666" }}>JUDGE CHECKLIST</div><Checklist label="Facilitator" value={facilitator?.body?.reachable === true ? "LIVE" : "Probe / configure"} /><Checklist label="Challenge" value={challenge?.status === 402 ? "402 RECEIVED" : "Not run"} /><Checklist label="Wallet" value={wallet ? "CONNECTED" : "Not connected"} /><Checklist label="Settlement" value={settled && tx ? `TX ${tx.slice(0, 10)}…` : "Not run"} /><Checklist label="Demo issuer" value="Self-signed · demo only" /></div></section>
  </div></main>;
}

function Step({ n, title, detail }: { n: string; title: string; detail: string }) { return <div style={{ display: "grid", gridTemplateColumns: "42px 1fr", gap: 12, alignItems: "start" }}><span style={{ width: 42, height: 42, borderRadius: "50%", border: "1px solid #ddd", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 800 }}>{n}</span><div><strong>{title}</strong><div style={{ color: "#666", marginTop: 4, fontSize: 14 }}>{detail}</div></div></div>; }
function ActionCard({ title, detail, result, busy, onClick }: { title: string; detail: string; result: X402Result; busy: boolean; onClick: () => void }) { return <button disabled={busy} onClick={onClick} style={{ textAlign: "left", background: "white", border: "1px solid #ddd", borderRadius: 18, padding: 22, cursor: "pointer" }}><strong>{title}</strong><div style={{ color: "#666", marginTop: 6 }}>{detail}</div>{result && <pre style={{ marginTop: 14, background: "#f7f7f5", padding: 12, overflow: "auto", maxHeight: 200, fontSize: 11 }}>{pretty(result)}</pre>}</button>; }
function Checklist({ label, value }: { label: string; value: string }) { return <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #eee", padding: "9px 0", gap: 16, fontSize: 13 }}><span style={{ color: "#777" }}>{label}</span><strong>{value}</strong></div>; }
function buttonStyle(kind: "light" | "mint") { return { padding: "12px 13px", background: kind === "light" ? "white" : "#d9e7df", color: "#173e2b", border: 0, borderRadius: 10, fontWeight: 800, cursor: "pointer" }; }
