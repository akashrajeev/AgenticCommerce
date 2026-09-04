"use client";

import { useEffect, useMemo, useState } from "react";

type Opportunity = {
  offerTargetProductId: string;
  sourceProductId: string;
  sourceProductName: string;
  productName: string;
  score: number;
  rationale: string;
  incrementalRevenuePaise: number;
};

type Campaign = {
  id: string;
  name: string;
  objective: string;
  strategy: "CROSS_SELL" | "UPSELL";
  opportunities: Opportunity[];
};

type Candidate = {
  transactionId: string;
  authorizationId: string;
  productId: string | null;
  amountPaise: number | null;
  state: string;
  razorpayOrderId: string | null;
};

type Result = Candidate & { ok: boolean; body?: unknown; error?: string };

type Payload = {
  campaign?: Campaign;
  campaigns?: Campaign[];
  candidates?: Candidate[];
  error?: string;
};

const money = (paise: number | null) => typeof paise === "number"
  ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100)
  : "—";

export default function CampaignOrchestratorPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const activeCampaign = useMemo(() => campaigns.find((item) => item.id === campaignId) ?? campaigns[0] ?? null, [campaigns, campaignId]);

  async function load(nextCampaignId?: string) {
    setLoading(true);
    setError("");
    try {
      const query = nextCampaignId ? `?campaignId=${encodeURIComponent(nextCampaignId)}` : "";
      const response = await fetch(`/api/campaign-orchestrator${query}`, { cache: "no-store" });
      const body = await response.json() as Payload;
      if (!response.ok) throw new Error(body.error ?? "Unable to load campaign orchestrator.");
      setCampaigns(body.campaigns ?? (body.campaign ? [body.campaign] : []));
      const resolved = body.campaign?.id ?? nextCampaignId ?? body.campaigns?.[0]?.id ?? "";
      setCampaignId(resolved);
      setCandidates(body.candidates ?? []);
      setSelected([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load campaign orchestrator.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function launch() {
    if (!activeCampaign || selected.length === 0) return;
    setRunning(true);
    setError("");
    try {
      const response = await fetch("/api/campaign-orchestrator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId: activeCampaign.id, transactionIds: selected }),
        cache: "no-store",
      });
      const body = await response.json() as { results?: Result[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Campaign launch failed.");
      setResults(body.results ?? []);
      await load(activeCampaign.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Campaign launch failed.");
    } finally {
      setRunning(false);
    }
  }

  function toggle(id: string) {
    setSelected((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : current.length < 5 ? [...current, id] : current);
  }

  const opportunityByProduct = useMemo(() => new Map((activeCampaign?.opportunities ?? []).map((item) => [item.offerTargetProductId, item])), [activeCampaign]);
  const expectedLift = selected.reduce((sum, id) => {
    const candidate = candidates.find((item) => item.transactionId === id);
    const opportunity = candidate?.productId ? opportunityByProduct.get(candidate.productId) : undefined;
    return sum + (opportunity?.incrementalRevenuePaise ?? 0);
  }, 0);

  return (
    <main style={{ minHeight: "100vh", background: "#f4f4f1", color: "#171717", fontFamily: "Arial, sans-serif", padding: "34px 20px 68px" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 24 }}>
          <div>
            <div style={{ fontSize: 11, color: "#1e5b3e", letterSpacing: ".14em", fontWeight: 800 }}>MERCHANT AGENT · TEST MODE</div>
            <h1 style={{ fontSize: 48, lineHeight: 1, letterSpacing: "-.05em", margin: "10px 0 12px" }}>Campaign orchestrator</h1>
            <p style={{ maxWidth: 780, color: "#666", lineHeight: 1.7, margin: 0 }}>Turn a merchant growth strategy into real, bounded Razorpay Test Mode orders. Only existing MANDATE-authorized transactions that match the campaign opportunity can enter a cohort.</p>
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            <a href="/growth" style={{ color: "#171717", fontWeight: 700, textDecoration: "none" }}>Growth dashboard →</a>
            <a href="/" style={{ color: "#777", textDecoration: "none" }}>Operations</a>
          </div>
        </header>

        {error ? <div style={{ marginTop: 18, padding: 14, border: "1px solid #dfc1bc", background: "#f6e9e7", color: "#7b302b", fontSize: 12 }}>{error}</div> : null}

        <section style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <section style={{ background: "white", border: "1px solid #dddcd7", padding: 22 }}>
            <div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 800 }}>1 · CAMPAIGN</div>
            <select value={campaignId} disabled={loading || running} onChange={(event) => { setCampaignId(event.target.value); void load(event.target.value); }} style={{ width: "100%", marginTop: 10, padding: 12, border: "1px solid #ccc", background: "white", fontWeight: 700 }}>
              {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name} · {campaign.strategy}</option>)}
            </select>
            {activeCampaign ? <div style={{ marginTop: 16 }}><strong style={{ fontSize: 21 }}>{activeCampaign.objective}</strong><div style={{ marginTop: 14, display: "grid", gap: 8 }}>{activeCampaign.opportunities.map((opportunity) => <div key={`${opportunity.offerTargetProductId}:${opportunity.sourceProductId}`} style={{ border: "1px solid #e5e5e1", padding: 12, background: "#fafaf7" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><strong>{opportunity.sourceProductName} → {opportunity.productName}</strong><span style={{ color: "#1e5b3e", fontWeight: 800 }}>+{money(opportunity.incrementalRevenuePaise)}</span></div><div style={{ color: "#777", fontSize: 11, marginTop: 5 }}>score {opportunity.score} · {opportunity.rationale}</div></div>)}</div></div> : null}
          </section>

          <section style={{ background: "#171717", color: "white", padding: 22 }}>
            <div style={{ fontSize: 10, color: "#bbb", letterSpacing: ".1em", fontWeight: 800 }}>2 · LAUNCH RULE</div>
            <h2 style={{ fontSize: 25, margin: "8px 0 10px" }}>No mandate. No order.</h2>
            <p style={{ color: "#bbb", fontSize: 12, lineHeight: 1.7, margin: 0 }}>The orchestrator never accepts an arbitrary amount or payment ID. It selects only transactions already authorized by MANDATE and delegates order creation to the guarded MCP gateway.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
              <Metric label="Selected" value={`${selected.length}/5`} />
              <Metric label="Expected lift" value={money(expectedLift)} />
            </div>
            <button disabled={running || selected.length === 0 || !activeCampaign} onClick={() => void launch()} style={{ width: "100%", marginTop: 17, padding: 13, border: 0, background: "white", color: "#171717", fontWeight: 800, cursor: selected.length ? "pointer" : "not-allowed" }}>{running ? "Creating Test Mode orders…" : "Launch Test Mode cohort →"}</button>
          </section>
        </section>

        <section style={{ marginTop: 16, background: "white", border: "1px solid #dddcd7" }}>
          <div style={{ padding: 20, borderBottom: "1px solid #e6e6e2" }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 800 }}>3 · ELIGIBLE TRANSACTIONS</div><h2 style={{ margin: "7px 0 0", fontSize: 25 }}>Real MANDATE-authorized cohort candidates</h2></div>
          {loading ? <div style={{ padding: 22, color: "#777" }}>Reading live gateway state…</div> : candidates.length === 0 ? <div style={{ padding: 22, color: "#777" }}>No eligible authorized transactions. Run the flagship agent negotiation first.</div> : <div>{candidates.map((candidate) => { const checked = selected.includes(candidate.transactionId); return <label key={candidate.transactionId} style={{ display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 14, alignItems: "center", padding: 16, borderBottom: "1px solid #eee", background: checked ? "#f1f7f3" : "white", cursor: "pointer" }}><input type="checkbox" checked={checked} onChange={() => toggle(candidate.transactionId)} /><div><div style={{ fontWeight: 800 }}>{candidate.productId ?? "Transaction"}</div><div style={{ marginTop: 4, fontSize: 10, color: "#777", fontFamily: "monospace", wordBreak: "break-all" }}>{candidate.transactionId}</div><div style={{ marginTop: 4, fontSize: 10, color: "#777" }}>MANDATE {candidate.authorizationId} · {candidate.state}</div></div><div style={{ textAlign: "right" }}><strong>{money(candidate.amountPaise)}</strong><div style={{ fontSize: 10, color: candidate.razorpayOrderId ? "#1e5b3e" : "#777", marginTop: 4 }}>{candidate.razorpayOrderId ? "Razorpay order exists" : "No order yet"}</div></div></label>; })}</div>}
        </section>

        {results.length ? <section style={{ marginTop: 16, background: "white", border: "1px solid #dddcd7", padding: 20 }}><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 800 }}>4 · REAL RAZORPAY TEST MODE RESULTS</div><div style={{ display: "grid", gap: 8, marginTop: 12 }}>{results.map((result) => <div key={result.transactionId} style={{ display: "flex", justifyContent: "space-between", gap: 16, border: "1px solid #e5e5e1", padding: 12 }}><span style={{ fontFamily: "monospace", fontSize: 10, wordBreak: "break-all" }}>{result.transactionId}</span><strong style={{ color: result.ok ? "#1e5b3e" : "#8d332d" }}>{result.ok ? "TEST ORDER CREATED" : result.error ?? "FAILED"}</strong></div>)}</div><p style={{ margin: "12px 0 0", color: "#777", fontSize: 11 }}>Complete these orders through Razorpay Test Mode Checkout. Then return to <a href="/growth">/growth</a>; only captured payments independently re-read from Razorpay contribute to realized uplift.</p></section> : null}
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div style={{ border: "1px solid #393939", padding: 12 }}><div style={{ fontSize: 9, color: "#aaa", letterSpacing: ".08em" }}>{label}</div><strong style={{ display: "block", marginTop: 5, fontSize: 22 }}>{value}</strong></div>;
}
