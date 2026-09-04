"use client";

import { useEffect, useMemo, useState } from "react";

type AgentRun = {
  id: string;
  state: string;
  plannerCalls: number;
  plannerModel?: string;
  createdAt: string;
  selectedOpportunity?: { sourceProductId?: string; targetProductId?: string; incrementalRevenuePaise?: number };
  preparedOffer?: { bundleAmountPaise: number; incrementalRevenuePaise: number; lineItems: Array<{ productId: string; quantity: number }> };
  trace?: Array<{ step: number; tool: string; status: string; durationMs?: number; error?: string }>;
};

type Experiment = { experimentId: string; campaignId: string; name: string; objective: string; treatment: number; control: number };
type Execution = { transactionId: string; cohort: "treatment" | "control"; status: string; attempt: number; razorpayOrderId?: string; razorpayPaymentId?: string; lastError?: string; updatedAt: string };
type Evidence = {
  independentlyVerified: boolean;
  metrics?: {
    assignedTreatment: number;
    assignedControl: number;
    verifiedTreatment: number;
    verifiedControl: number;
    treatmentAovPaise: number | null;
    controlAovPaise: number | null;
    observedAovUpliftPercent: number | null;
    realizedIncrementalRevenuePaise: number;
    treatmentVerificationRate: number;
    controlVerificationRate: number;
  };
  executions?: Execution[];
  interpretation?: string;
};

const money = (paise: number | null | undefined) => typeof paise === "number" ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100) : "—";
const pct = (value: number | null | undefined) => typeof value === "number" ? `${value.toFixed(1)}%` : "—";

export default function JudgeGrowthPage() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [experimentId, setExperimentId] = useState("");
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<string>("");

  async function refresh() {
    setError("");
    try {
      const [agentResponse, experimentResponse] = await Promise.all([
        fetch("/api/agent/growth-agent", { cache: "no-store" }),
        fetch("/api/agent/growth-experiment", { cache: "no-store" }),
      ]);
      const agentBody = await agentResponse.json();
      const experimentBody = await experimentResponse.json();
      if (!agentResponse.ok) throw new Error(agentBody.error ?? "Unable to load Growth Agent runs.");
      if (!experimentResponse.ok) throw new Error(experimentBody.error ?? "Unable to load experiments.");
      setRuns(agentBody.runs ?? []);
      const nextExperiments = (experimentBody.experiments ?? []) as Experiment[];
      setExperiments(nextExperiments);
      const selected = experimentId && nextExperiments.some((item) => item.experimentId === experimentId) ? experimentId : nextExperiments[0]?.experimentId ?? "";
      setExperimentId(selected);
      if (selected) await refreshEvidence(selected);
      setLastRefresh(new Date().toLocaleTimeString());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Judge console refresh failed.");
    }
  }

  async function refreshEvidence(nextExperimentId = experimentId) {
    if (!nextExperimentId) return;
    try {
      const response = await fetch(`/api/agent/growth-experiment/evidence?experimentId=${encodeURIComponent(nextExperimentId)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Evidence unavailable.");
      setEvidence(body as Evidence);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Evidence refresh failed.");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const latestRun = runs[0];
  const selectedExperiment = experiments.find((item) => item.experimentId === experimentId);
  const metrics = evidence?.metrics;
  const executions = evidence?.executions ?? [];
  const pending = executions.filter((item) => item.status === "PAYMENT_PENDING").length;
  const recovered = executions.filter((item) => item.status === "RECOVERY_READY").length;
  const confirmed = executions.filter((item) => item.status === "CONFIRMED").length;
  const blocked = executions.filter((item) => item.status === "FAILED").length;

  const stage = useMemo(() => [
    ["01", "AGENT", latestRun ? `${latestRun.plannerCalls} planner call(s) · ${latestRun.trace?.length ?? 0} bounded steps` : "No persisted Growth Agent run yet."],
    ["02", "MANDATE", selectedExperiment ? `${selectedExperiment.treatment} treatment · ${selectedExperiment.control} control assignments` : "No experiment assigned yet."],
    ["03", "TEST MODE", `${confirmed} independently verified · ${pending} awaiting payment · ${blocked + recovered} needing attention`],
    ["04", "UPLIFT", metrics?.observedAovUpliftPercent !== null && metrics?.observedAovUpliftPercent !== undefined ? `Observed AOV difference ${pct(metrics.observedAovUpliftPercent)}` : "Awaiting enough verified payments"],
  ], [latestRun, selectedExperiment, confirmed, pending, blocked, recovered, metrics]);

  return <main style={{ minHeight: "100vh", background: "#f4f4f1", color: "#171717", fontFamily: "Arial, sans-serif", padding: "34px 22px 80px" }}>
    <div style={{ maxWidth: 1240, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 24 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: ".14em", color: "#1e5b3e", fontWeight: 800 }}>MANDATE · TRACK 01 · JUDGE PROOF</div>
          <h1 style={{ fontSize: 52, lineHeight: 1, letterSpacing: "-.06em", margin: "9px 0 12px" }}>An agent that changes revenue — without owning the money.</h1>
          <p style={{ maxWidth: 900, color: "#666", lineHeight: 1.7, margin: 0 }}>One evidence chain from model-directed growth strategy to a bounded mandate, real Razorpay Test Mode payment, and an observed treatment/control basket comparison. Refresh: {lastRefresh || "—"}.</p>
        </div>
        <nav style={{ display: "flex", gap: 14 }}><a href="/growth" style={{ textDecoration: "none", color: "#777" }}>Growth</a><a href="/growth-experiment" style={{ textDecoration: "none", color: "#171717", fontWeight: 800 }}>Experiment</a><a href="/growth-attribution" style={{ textDecoration: "none", color: "#777" }}>Attribution</a></nav>
      </header>

      {error ? <div style={{ marginTop: 18, padding: 13, background: "#f9e9e6", border: "1px solid #e0bfba", color: "#7c2f29", fontSize: 12 }}>{error}</div> : null}

      <section style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {stage.map(([num, title, detail]) => <div key={num} style={{ background: "white", border: "1px solid #dddcd7", padding: 17, minHeight: 132 }}><div style={{ color: "#999", fontSize: 10, letterSpacing: ".12em", fontWeight: 800 }}>{num}</div><h2 style={{ fontSize: 18, margin: "7px 0" }}>{title}</h2><p style={{ color: "#666", fontSize: 11, lineHeight: 1.5, margin: 0 }}>{detail}</p></div>)}
      </section>

      <section style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1.05fr .95fr", gap: 14 }}>
        <section style={{ background: "#171717", color: "white", padding: 22 }}>
          <div style={{ fontSize: 10, letterSpacing: ".12em", color: "#aaa", fontWeight: 800 }}>AGENT TRACE</div>
          <h2 style={{ margin: "7px 0", fontSize: 25 }}>{latestRun ? latestRun.state : "Awaiting agent run"}</h2>
          <p style={{ color: "#bbb", fontSize: 12, lineHeight: 1.6 }}>The latest run is the persisted Growth Agent execution, not a client-generated timeline.</p>
          {latestRun ? <><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}><div style={{ border: "1px solid #333", padding: 12 }}><small style={{ color: "#aaa" }}>Planner</small><strong style={{ display: "block", marginTop: 4 }}>{latestRun.plannerModel ?? "Responses API"}</strong></div><div style={{ border: "1px solid #333", padding: 12 }}><small style={{ color: "#aaa" }}>Run</small><strong style={{ display: "block", marginTop: 4, fontFamily: "monospace", fontSize: 10 }}>{latestRun.id}</strong></div></div><div style={{ marginTop: 12 }}>{(latestRun.trace ?? []).slice(0, 8).map((step) => <div key={step.step} style={{ display: "grid", gridTemplateColumns: "34px 1fr auto", gap: 8, padding: "8px 0", borderBottom: "1px solid #2d2d2d", fontSize: 11 }}><span style={{ color: "#888" }}>{step.step}</span><strong>{step.tool}</strong><span style={{ color: step.error ? "#ffb6ad" : "#aaa" }}>{step.error ?? `${step.status}${step.durationMs !== undefined ? ` · ${step.durationMs}ms` : ""}`}</span></div>)}</div></> : null}
        </section>

        <section style={{ background: "white", border: "1px solid #dddcd7", padding: 22 }}>
          <div style={{ fontSize: 10, letterSpacing: ".12em", color: "#777", fontWeight: 800 }}>EXPERIMENT</div>
          <select value={experimentId} onChange={(event) => { setExperimentId(event.target.value); void refreshEvidence(event.target.value); }} style={{ width: "100%", marginTop: 9, padding: 11, border: "1px solid #ccc", background: "white", fontWeight: 800 }}>
            {experiments.length ? experiments.map((item) => <option key={item.experimentId} value={item.experimentId}>{item.name}</option>) : <option value="">No experiments yet</option>}
          </select>
          <p style={{ color: "#666", fontSize: 12, lineHeight: 1.6, margin: "12px 0 18px" }}>{selectedExperiment?.objective ?? "Create a persisted treatment/control experiment from eligible MANDATE-authorized transactions."}</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Metric label="Treatment assigned" value={metrics?.assignedTreatment ?? selectedExperiment?.treatment ?? 0} />
            <Metric label="Control assigned" value={metrics?.assignedControl ?? selectedExperiment?.control ?? 0} />
            <Metric label="Treatment verified" value={metrics?.verifiedTreatment ?? 0} />
            <Metric label="Control verified" value={metrics?.verifiedControl ?? 0} />
          </div>
          <div style={{ marginTop: 16, paddingTop: 15, borderTop: "1px solid #eee" }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}><span style={{ color: "#777", fontSize: 11 }}>Treatment AOV</span><strong>{money(metrics?.treatmentAovPaise)}</strong></div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}><span style={{ color: "#777", fontSize: 11 }}>Control AOV</span><strong>{money(metrics?.controlAovPaise)}</strong></div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", marginTop: 5, borderTop: "1px solid #eee" }}><span style={{ fontWeight: 800 }}>Observed AOV uplift</span><strong style={{ fontSize: 22 }}>{pct(metrics?.observedAovUpliftPercent)}</strong></div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}><span style={{ color: "#777", fontSize: 11 }}>Realized incremental revenue</span><strong>{money(metrics?.realizedIncrementalRevenuePaise)}</strong></div>
          </div>
        </section>
      </section>

      <section style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <section style={{ background: "white", border: "1px solid #dddcd7", padding: 20 }}>
          <div style={{ fontSize: 10, letterSpacing: ".12em", color: "#777", fontWeight: 800 }}>EXECUTION STATE</div>
          <h2 style={{ margin: "7px 0 15px", fontSize: 22 }}>Cohort members</h2>
          {executions.length === 0 ? <p style={{ color: "#777", fontSize: 12 }}>No cohort executions recorded yet.</p> : executions.map((item) => <div key={item.transactionId} style={{ display: "grid", gridTemplateColumns: "82px 1fr auto", gap: 10, alignItems: "center", padding: 10, borderTop: "1px solid #eee", fontSize: 11 }}><span style={{ fontWeight: 800 }}>{item.cohort.toUpperCase()}</span><div><strong style={{ fontFamily: "monospace" }}>{item.transactionId}</strong><div style={{ color: "#888", marginTop: 3 }}>attempt {item.attempt}{item.lastError ? ` · ${item.lastError}` : ""}</div></div><span style={{ fontWeight: 800 }}>{item.status}</span></div>)}
        </section>
        <section style={{ background: "white", border: "1px solid #dddcd7", padding: 20 }}>
          <div style={{ fontSize: 10, letterSpacing: ".12em", color: "#777", fontWeight: 800 }}>EVIDENCE CONTRACT</div>
          <h2 style={{ margin: "7px 0 12px", fontSize: 22 }}>{evidence?.independentlyVerified ? "Independently verified" : "Waiting for verification"}</h2>
          <p style={{ color: "#666", fontSize: 12, lineHeight: 1.7, margin: 0 }}>{evidence?.interpretation ?? "The evidence endpoint only counts independently verified Razorpay Test Mode payments linked to persisted experiment assignments."}</p>
          <div style={{ marginTop: 14, padding: 13, background: "#f6f6f2", border: "1px solid #e6e5df", fontSize: 11, lineHeight: 1.6 }}>
            <strong>Boundary</strong><br />Growth Agent → commercial proposal<br />MANDATE → authority and policy<br />Razorpay → Test Mode execution<br />Evidence → verified payment outcome
          </div>
          <a href="/growth-experiment" style={{ display: "inline-block", marginTop: 14, color: "#171717", fontWeight: 800, fontSize: 12 }}>Open full experiment console →</a>
        </section>
      </section>
    </div>
  </main>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div style={{ padding: 12, border: "1px solid #e6e5df" }}><small style={{ color: "#777" }}>{label}</small><strong style={{ display: "block", fontSize: 25, marginTop: 3 }}>{value}</strong></div>;
}
