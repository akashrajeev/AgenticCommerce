"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./protocols.module.css";

type Protocol = {
  id: string;
  name: string;
  status: string;
  transport: string;
  authority: string;
  evidence: string;
  demoEnabled: boolean;
  live: { ok: boolean; status: number; detail: string };
};

type RoutePlan = {
  id: string;
  name: string;
  status: string;
  transport: string;
  authority: string;
  evidence: string;
  demoEnabled: boolean;
};

type RouterBody = {
  generatedAt: string;
  summary: { total: number; executable: number; adapterReady: number };
  protocols: Protocol[];
  routes: Record<string, RoutePlan>;
};

const targets = [
  ["merchant-checkout", "Merchant checkout", "Agent buys a merchant product"],
  ["agent-service", "Paid agent service", "Agent pays an HTTP-native service"],
  ["tool-payment", "Payment tool", "Agent invokes a guarded payment tool"],
  ["delegated-upi", "Delegated UPI", "Agent acts within delegated UPI authority"],
] as const;

const statusLabel: Record<string, string> = {
  implemented: "EXECUTABLE",
  experiment: "EXPERIMENT",
  "adapter-target": "TARGET",
  "semantic-alignment": "ALIGNED",
  "research-adapter-ready": "ADAPTER-READY",
};

export default function ProtocolsPage() {
  const [data, setData] = useState<RouterBody | null>(null);
  const [target, setTarget] = useState("merchant-checkout");
  const [result, setResult] = useState<RoutePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Loading protocol control plane…");

  async function load() {
    const response = await fetch("/api/protocol-router", { cache: "no-store" });
    const body = await response.json() as RouterBody;
    if (!response.ok) throw new Error("Protocol router unavailable");
    setData(body);
    setResult(body.routes["merchant-checkout"] ?? null);
    setMessage(`Live matrix refreshed at ${new Date(body.generatedAt).toLocaleTimeString()}.`);
  }

  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load protocol matrix.")); }, []);

  async function resolve() {
    setBusy(true);
    try {
      const response = await fetch("/api/protocol-router", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target }) });
      const body = await response.json() as { selected?: RoutePlan; error?: string; referenceProtocol?: Protocol };
      if (!response.ok || !body.selected) throw new Error(body.error ?? "Route unavailable");
      setResult(body.selected);
      setMessage(`${body.selected.name} selected for ${target}. MANDATE remains the authority boundary.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Route unavailable");
    } finally {
      setBusy(false);
    }
  }

  const executable = useMemo(() => data?.protocols.filter((protocol) => protocol.demoEnabled).length ?? 0, [data]);

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}><span className={styles.mark}>M</span><div><strong>MANDATE</strong><small>Unified protocol control plane</small></div></div>
        <nav><a href="/">Buyer</a><a href="/negotiation">Negotiation</a><a href="/delegated-mandates">Delegated authority</a><a href="/x402">x402</a></nav>
      </header>

      <section className={styles.hero}>
        <div>
          <span className={styles.kicker}>PHASE 11 → PHASE 12</span>
          <h1>Different protocols.<br /><em>One authority boundary.</em></h1>
          <p>MANDATE normalizes protocol discovery, delegated authority and payment evidence without pretending every external protocol is already production-integrated.</p>
        </div>
        <div className={styles.metrics}>
          <div><strong>{data?.summary.total ?? "—"}</strong><span>protocols tracked</span></div>
          <div><strong>{data?.summary.executable ?? executable}</strong><span>demo-executable</span></div>
          <div><strong>{data?.summary.adapterReady ?? "—"}</strong><span>future adapters</span></div>
        </div>
      </section>

      <section className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelHead}><div><span className={styles.kicker}>LIVE MATRIX</span><h2>Protocol registry</h2></div><span className={styles.liveDot}>LIVE</span></div>
          <div className={styles.protocols}>
            {data?.protocols.map((protocol) => (
              <article className={styles.protocol} key={protocol.id}>
                <div className={styles.protocolTop}><div><strong>{protocol.name}</strong><small>{protocol.transport}</small></div><span className={`${styles.badge} ${protocol.demoEnabled ? styles.good : ""}`}>{statusLabel[protocol.status] ?? protocol.status}</span></div>
                <p>{protocol.authority}</p>
                <div className={styles.evidence}><span>Evidence</span><b>{protocol.evidence}</b></div>
                <div className={styles.live}><span>runtime</span><b>{protocol.live.detail}</b>{protocol.live.ok ? <i>●</i> : <i className={styles.off}>●</i>}</div>
              </article>
            ))}
          </div>
        </section>

        <aside className={styles.panel}>
          <div className={styles.panelHead}><div><span className={styles.kicker}>ROUTE AN AGENT REQUEST</span><h2>Resolver</h2></div></div>
          <p className={styles.note}>The resolver only selects executable protocols. Research/alignment targets stay visible but cannot silently become payment authority.</p>
          <div className={styles.targets}>
            {targets.map(([id, label, description]) => <button key={id} className={id === target ? styles.targetActive : ""} onClick={() => setTarget(id)}><div><strong>{label}</strong><small>{description}</small></div><span>→</span></button>)}
          </div>
          <button className={styles.resolve} disabled={busy} onClick={() => void resolve()}>{busy ? "Resolving…" : "Resolve protocol"}<span>→</span></button>
          {result && <div className={styles.result}><span>SELECTED ADAPTER</span><strong>{result.name}</strong><small>{result.transport}</small><small>authority → {result.authority}</small><b>{result.demoEnabled ? "EXECUTABLE IN DEMO" : "NOT EXECUTABLE"}</b></div>}
          <div className={styles.message}>{message}</div>
        </aside>
      </section>

      <section className={styles.boundary}>
        <div><span className={styles.kicker}>NON-NEGOTIABLE</span><h2>Protocol choice never becomes payment authority.</h2></div>
        <div className={styles.flow}><span>Agent / Model</span><b>→</b><span>Protocol adapter</span><b>→</b><strong>MANDATE policy core</strong><b>→</b><span>payment rail</span></div>
      </section>
    </main>
  );
}
