"use client";

import Script from "next/script";
import { useEffect, useMemo, useState } from "react";

type Candidate = {
  transactionId: string;
  authorizationId: string;
  cohort: "treatment" | "control";
  sourceProductId: string;
  targetProductId?: string;
  amountPaise: number | null;
  currency: string;
  state: string;
};

type Experiment = {
  experimentId: string;
  campaignId: string;
  name: string;
  objective: string;
};

type LaunchResult = Candidate & { ok: boolean; order?: { id: string; amount: number; currency: string }; checkout?: { keyId: string; currency: "INR" }; error?: string };
type Evidence = { metrics?: { assignedTreatment: number; assignedControl: number; verifiedTreatment: number; verifiedControl: number; treatmentAovPaise: number | null; controlAovPaise: number | null; observedAovUpliftPercent: number | null; realizedIncrementalRevenuePaise: number; treatmentVerificationRate: number; controlVerificationRate: number }; interpretation?: string };

declare global { interface Window { Razorpay?: new (options: Record<string, unknown>) => { open: () => void } } }

const money = (paise: number | null) => typeof paise === "number" ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100) : "—";
const pct = (value: number | null) => typeof value === "number" ? `${value.toFixed(1)}%` : "—";

export default function GrowthExperimentPage() {
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string; objective: string }>>([]);
  const [campaignId, setCampaignId] = useState("");
  const [treatment, setTreatment] = useState<Candidate[]>([]);
  const [control, setControl] = useState<Candidate[]>([]);
  const [selectedTreatment, setSelectedTreatment] = useState<string[]>([]);
  const [selectedControl, setSelectedControl] = useState<string[]>([]);
  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [results, setResults] = useState<LaunchResult[]>([]);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const batchSize = useMemo(() => Math.min(5, treatment.length, control.length), [treatment.length, control.length]);

  async function loadCandidates(nextCampaignId?: string) {
    const resolved = nextCampaignId ?? campaignId;
    if (!resolved) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/agent/growth-experiment/candidates?campaignId=${encodeURIComponent(resolved)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load experiment candidates.");
      setTreatment(body.treatmentCandidates ?? []);
      setControl(body.controlCandidates ?? []);
      setSelectedTreatment([]); setSelectedControl([]);
      setMessage(`Found ${body.treatmentCandidates?.length ?? 0} treatment candidates and ${body.controlCandidates?.length ?? 0} control candidates.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Candidate loading failed."); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/agent/growth-experiment", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Unable to load campaigns.");
        const nextCampaigns = (body.experiments ?? []).map((item: { campaignId: string; name: string; objective: string }) => ({ id: item.campaignId, name: item.name, objective: item.objective }));
        if (nextCampaigns.length) { setCampaigns(nextCampaigns); setCampaignId(nextCampaigns[0].id); void loadCandidates(nextCampaigns[0].id); }
      } catch {
        setCampaigns([{ id: "headphone-aov", name: "Headphone AOV lift", objective: "Measure observed basket-value uplift from a complementary recommendation." }]);
        setCampaignId("headphone-aov");
        void loadCandidates("headphone-aov");
      }
    })();
  }, []);

  function toggle(value: string, cohort: "treatment" | "control") {
    const setter = cohort === "treatment" ? setSelectedTreatment : setSelectedControl;
    setter((current) => current.includes(value) ? current.filter((item) => item !== value) : current.length < batchSize ? [...current, value] : current);
  }

  async function assign() {
    if (!campaignId || selectedTreatment.length !== selectedControl.length || selectedTreatment.length < 1) return;
    setBusy(true); setError(""); setResults([]); setEvidence(null);
    try {
      const response = await fetch("/api/agent/growth-experiment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaignId, treatmentTransactionIds: selectedTreatment, controlTransactionIds: selectedControl }), cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Experiment assignment failed.");
      setExperiment(body.experiment);
      setMessage(`Persisted ${body.assignments?.length ?? 0} experiment assignments in PostgreSQL.`);
      await loadCandidates(campaignId);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Experiment assignment failed."); }
    finally { setBusy(false); }
  }

  async function launch(cohorts: Array<"treatment" | "control">) {
    if (!experiment) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/agent/growth-experiment/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ experimentId: experiment.experimentId, cohorts }), cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Cohort launch failed.");
      const nextResults = body.results ?? [];
      setResults(nextResults);
      setMessage(`Launch returned ${nextResults.filter((item: LaunchResult) => item.ok).length} real Test Mode order(s).`);
      await refreshEvidence(experiment.experimentId);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Cohort launch failed."); }
    finally { setBusy(false); }
  }

  async function refreshEvidence(experimentId = experiment?.experimentId) {
    if (!experimentId) return;
    try {
      const response = await fetch(`/api/agent/growth-experiment/evidence?experimentId=${encodeURIComponent(experimentId)}`, { cache: "no-store" });
      if (!response.ok) return;
      setEvidence(await response.json());
    } catch { /* evidence remains last known */ }
  }

  function pay(result: LaunchResult) {
    if (!result.ok || !result.order || !result.checkout) return;
    if (!window.Razorpay) { setError("Razorpay Checkout is still loading."); return; }
    const instance = new window.Razorpay({
      key: result.checkout.keyId,
      amount: result.order.amount,
      currency: result.checkout.currency,
      name: "Mandate Market",
      description: `${result.cohort === "treatment" ? "Treatment" : "Control"} · Test Mode cohort`,
      order_id: result.order.id,
      handler: async () => {
        setMessage("Payment callback received. Gateway verification and merchant confirmation are authoritative.");
        await new Promise((resolve) => setTimeout(resolve, 1800));
        await refreshEvidence();
      },
      modal: { ondismiss: () => setMessage("Checkout dismissed; no uplift is counted until an independently verified captured payment exists.") },
    });
    instance.open();
  }

  const selectedReady = selectedTreatment.length > 0 && selectedTreatment.length === selectedControl.length;
  const metrics = evidence?.metrics;

  return <>
    <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
    <main style={{ minHeight: "100vh", background: "#f4f4f1", color: "#171717", fontFamily: "Arial, sans-serif", padding: "34px 20px 72px" }}>
      <div style={{ maxWidth: 1160, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 24 }}>
          <div><div style={{ fontSize: 10, letterSpacing: ".13em", color: "#1e5b3e", fontWeight: 800 }}>PHASE C+ · GROWTH EXPERIMENT</div><h1 style={{ fontSize: 48, lineHeight: 1, letterSpacing: "-.05em", margin: "9px 0 12px" }}>Prove the agent changed the basket.</h1><p style={{ maxWidth: 820, color: "#666", lineHeight: 1.7, margin: 0 }}>Balanced Test Mode treatment/control cohorts. Assignments persist before execution; order creation still requires an existing MANDATE authorization; uplift counts only after independent Razorpay Test Mode verification.</p></div>
          <div style={{ display: "flex", gap: 14 }}><a href="/campaign-orchestrator" style={{ color: "#171717", fontWeight: 700, textDecoration: "none" }}>Orchestrator</a><a href="/growth" style={{ color: "#777", textDecoration: "none" }}>Growth dashboard</a></div>
        </header>

        {error ? <div style={{ marginTop: 18, padding: 14, border: "1px solid #dfc1bc", background: "#f6e9e7", color: "#7b302b", fontSize: 12 }}>{error}</div> : null}
        {message ? <div style={{ marginTop: 12, padding: 14, border: "1px solid #d5d5cf", background: "white", color: "#555", fontSize: 12 }}>{message}</div> : null}

        <section style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <section style={{ background: "white", border: "1px solid #dddcd7", padding: 20 }}>
            <div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 800 }}>1 · EXPERIMENT DESIGN</div>
            <select value={campaignId} onChange={(event) => { setCampaignId(event.target.value); void loadCandidates(event.target.value); }} style={{ width: "100%", marginTop: 9, padding: 11, border: "1px solid #ccc", background: "white", fontWeight: 800 }}>
              {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
            </select>
            <p style={{ color: "#666", fontSize: 12, lineHeight: 1.6, margin: "12px 0 0" }}>{campaigns.find((item) => item.id === campaignId)?.objective ?? "Persist a balanced treatment/control experiment."}</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 15 }}>
              <div style={{ border: "1px solid #e5e5e0", padding: 12 }}><small style={{ color: "#777" }}>Treatment pool</small><strong style={{ display: "block", fontSize: 22, marginTop: 4 }}>{treatment.length}</strong></div>
              <div style={{ border: "1px solid #e5e5e0", padding: 12 }}><small style={{ color: "#777" }}>Control pool</small><strong style={{ display: "block", fontSize: 22, marginTop: 4 }}>{control.length}</strong></div>
              <div style={{ border: "1px solid #e5e5e0", padding: 12 }}><small style={{ color: "#777" }}>Balanced batch</small><strong style={{ display: "block", fontSize: 22, marginTop: 4 }}>{batchSize}</strong></div>
            </div>
          </section>
          <section style={{ background: "#171717", color: "white", padding: 20 }}>
            <div style={{ fontSize: 10, color: "#aaa", letterSpacing: ".1em", fontWeight: 800 }}>EXPERIMENT GUARANTEE</div>
            <h2 style={{ margin: "8px 0 9px", fontSize: 24 }}>Assignment ≠ payment authority.</h2>
            <p style={{ color: "#bbb", fontSize: 12, lineHeight: 1.7, margin: 0 }}>The experiment only labels already-authorized transactions. Treatment orders receive the campaign ID; control orders do not. Both still pass through MCP → MANDATE → Razorpay Test Mode.</p>
            <button disabled={busy || !selectedReady} onClick={() => void assign()} style={{ width: "100%", marginTop: 15, padding: 12, border: 0, background: "white", color: "#171717", fontWeight: 800 }}>{busy ? "Working…" : selectedReady ? `Persist ${selectedTreatment.length} + ${selectedControl.length} cohort members →` : "Select an equal treatment/control sample"}</button>
          </section>
        </section>

        <section style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {([["treatment", treatment, selectedTreatment], ["control", control, selectedControl]] as const).map(([cohort, candidates, selected]) => <section key={cohort} style={{ background: "white", border: "1px solid #dddcd7" }}><div style={{ padding: 17, borderBottom: "1px solid #e7e7e2", display: "flex", justifyContent: "space-between", alignItems: "center" }}><div><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 800 }}>{cohort === "treatment" ? "2A · TREATMENT" : "2B · CONTROL"}</div><h2 style={{ margin: "5px 0 0", fontSize: 22 }}>{selected.length}/{batchSize} selected</h2></div><span style={{ color: cohort === "treatment" ? "#1e5b3e" : "#777", fontWeight: 800 }}>{cohort === "treatment" ? "growth basket" : "base basket"}</span></div>{candidates.length === 0 ? <div style={{ padding: 18, color: "#777", fontSize: 12 }}>No eligible {cohort} transactions yet.</div> : <div>{candidates.map((candidate) => { const checked = selected.includes(candidate.transactionId); return <label key={candidate.transactionId} style={{ display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 11, alignItems: "center", padding: 13, borderBottom: "1px solid #eee", background: checked ? "#f2f7f4" : "white", cursor: "pointer" }}><input type="checkbox" checked={checked} onChange={() => toggle(candidate.transactionId, cohort)} /><div><strong style={{ fontSize: 12 }}>{candidate.sourceProductId}{candidate.targetProductId ? ` → ${candidate.targetProductId}` : ""}</strong><div style={{ marginTop: 4, color: "#777", fontSize: 9, fontFamily: "monospace", wordBreak: "break-all" }}>{candidate.transactionId}</div><div style={{ marginTop: 3, color: "#777", fontSize: 9 }}>MANDATE {candidate.authorizationId}</div></div><strong style={{ fontSize: 13 }}>{money(candidate.amountPaise)}</strong></label>; })}</div>}</section>)}
        </section>

        {experiment ? <section style={{ marginTop: 14, background: "white", border: "1px solid #dddcd7", padding: 20 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "end" }}><div><div style={{ fontSize: 10, color: "#777", letterSpacing: ".1em", fontWeight: 800 }}>3 · PERSISTED EXPERIMENT</div><h2 style={{ margin: "5px 0 0", fontSize: 22 }}>{experiment.name}</h2><div style={{ marginTop: 4, color: "#777", fontSize: 10, fontFamily: "monospace" }}>{experiment.experimentId}</div></div><div style={{ display: "flex", gap: 8 }}><button disabled={busy} onClick={() => void launch(["treatment"])} style={{ border: 0, background: "#1e5b3e", color: "white", padding: "10px 12px", fontWeight: 800 }}>Launch treatment →</button><button disabled={busy} onClick={() => void launch(["control"])} style={{ border: "1px solid #ccc", background: "white", color: "#171717", padding: "10px 12px", fontWeight: 800 }}>Launch control →</button><button disabled={busy} onClick={() => void launch(["treatment", "control"])} style={{ border: "1px solid #ccc", background: "white", color: "#171717", padding: "10px 12px", fontWeight: 800 }}>Launch both</button></div></div><p style={{ color: "#777", fontSize: 11, lineHeight: 1.6 }}>{experiment.objective}</p>
        {results.length ? <div style={{ marginTop: 15, display: "grid", gap: 8 }}>{results.map((result) => <div key={`${result.cohort}:${result.transactionId}`} style={{ border: "1px solid #e4e4df", padding: 12, display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, alignItems: "center" }}><div><strong>{result.cohort.toUpperCase()}</strong><div style={{ marginTop: 4, color: "#777", fontSize: 9, fontFamily: "monospace", wordBreak: "break-all" }}>{result.transactionId}</div><div style={{ marginTop: 3, color: result.ok ? "#1e5b3e" : "#8d332d", fontSize: 10 }}>{result.ok ? `ORDER ${result.order?.id ?? "created"}` : result.error}</div></div>{result.order ? <strong>{money(result.order.amount)}</strong> : <span />}{result.ok && result.checkout ? <button onClick={() => pay(result)} style={{ border: 0, background: "#171717", color: "white", padding: "9px 11px", fontWeight: 800 }}>Pay in Test Mode →</button> : <span />}</div>)}</div> : null}
        </section> : null}

        {metrics ? <section style={{ marginTop: 14, background: "#171717", color: "white", padding: 20 }}><div style={{ fontSize: 10, color: "#aaa", letterSpacing: ".1em", fontWeight: 800 }}>4 · INDEPENDENTLY VERIFIED EVIDENCE</div><div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginTop: 12 }}>{[["Treatment AOV", money(metrics.treatmentAovPaise)], ["Control AOV", money(metrics.controlAovPaise)], ["Observed AOV uplift", pct(metrics.observedAovUpliftPercent)], ["Realized incremental revenue", money(metrics.realizedIncrementalRevenuePaise)]].map(([label, value]) => <div key={label} style={{ border: "1px solid #353535", padding: 13 }}><small style={{ color: "#999" }}>{label}</small><strong style={{ display: "block", marginTop: 6, fontSize: 23 }}>{value}</strong></div>)}</div><div style={{ marginTop: 12, color: "#aaa", fontSize: 10 }}>Verified treatment {metrics.verifiedTreatment}/{metrics.assignedTreatment} · verified control {metrics.verifiedControl}/{metrics.assignedControl} · verification rates {pct(metrics.treatmentVerificationRate)} / {pct(metrics.controlVerificationRate)}</div><p style={{ margin: "12px 0 0", color: "#bdbdb8", fontSize: 11, lineHeight: 1.6 }}>{evidence?.interpretation}</p></section> : null}
      </div>
    </main>
  </>;
}
