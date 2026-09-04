import postgres from "postgres";
import type { GrowthAgentRun, GrowthAgentTraceStep } from "./growth-agent";

let client: ReturnType<typeof postgres> | undefined;
let schemaReady: Promise<void> | undefined;

function getClient() {
  if (process.env.GROWTH_AGENT_PERSISTENCE_DISABLED === "1") return undefined;
  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) throw new Error("GROWTH_AGENT_PERSISTENCE_NOT_CONFIGURED");
  if (!client) client = postgres(databaseUrl, { max: 1, connect_timeout: 5, idle_timeout: 20, prepare: false });
  return client;
}

async function ensureSchema(): Promise<void> {
  const sql = getClient();
  if (!sql) return;
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS growth_agent_runs (
        id TEXT PRIMARY KEY,
        objective TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        max_spend_paise BIGINT,
        max_steps INTEGER NOT NULL,
        state TEXT NOT NULL,
        step_count INTEGER NOT NULL,
        planner_calls INTEGER NOT NULL,
        planner_model TEXT,
        last_planner_error TEXT,
        selected_opportunity JSONB,
        prepared_offer JSONB,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ
      )`;
      await sql`CREATE INDEX IF NOT EXISTS growth_agent_runs_campaign_created_idx ON growth_agent_runs(campaign_id, created_at DESC)`;
      await sql`CREATE TABLE IF NOT EXISTS growth_agent_steps (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES growth_agent_runs(id) ON DELETE CASCADE,
        step INTEGER NOT NULL,
        state TEXT NOT NULL,
        tool TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL,
        input JSONB NOT NULL,
        output JSONB,
        error TEXT,
        call_id TEXT,
        planner_model TEXT,
        started_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        duration_ms INTEGER,
        CONSTRAINT growth_agent_steps_run_step_key UNIQUE (run_id, step)
      )`;
      await sql`CREATE INDEX IF NOT EXISTS growth_agent_steps_run_started_idx ON growth_agent_steps(run_id, started_at)`;
    })().catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  await schemaReady;
}

function json(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stepId(runId: string, step: number): string {
  return `${runId}:step:${step}`;
}

export async function persistGrowthAgentCheckpoint(run: GrowthAgentRun, step?: GrowthAgentTraceStep): Promise<void> {
  const sql = getClient();
  if (!sql) return;
  await ensureSchema();
  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO growth_agent_runs (
        id, objective, campaign_id, max_spend_paise, max_steps, state, step_count, planner_calls,
        planner_model, last_planner_error, selected_opportunity, prepared_offer, created_at, updated_at, completed_at
      ) VALUES (
        ${run.id}, ${run.objective}, ${run.campaignId}, ${run.maxSpendPaise}, ${run.maxSteps}, ${run.state}, ${run.stepCount}, ${run.plannerCalls},
        ${run.plannerModel ?? null}, ${run.lastPlannerError ?? null}, ${json(run.selectedOpportunity)}, ${json(run.preparedOffer)},
        ${run.createdAt}, ${run.updatedAt}, ${run.completedAt ?? null}
      )
      ON CONFLICT (id) DO UPDATE SET
        objective = EXCLUDED.objective,
        campaign_id = EXCLUDED.campaign_id,
        max_spend_paise = EXCLUDED.max_spend_paise,
        max_steps = EXCLUDED.max_steps,
        state = EXCLUDED.state,
        step_count = EXCLUDED.step_count,
        planner_calls = EXCLUDED.planner_calls,
        planner_model = EXCLUDED.planner_model,
        last_planner_error = EXCLUDED.last_planner_error,
        selected_opportunity = EXCLUDED.selected_opportunity,
        prepared_offer = EXCLUDED.prepared_offer,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        completed_at = EXCLUDED.completed_at
    `;

    if (step) {
      await transaction`
        INSERT INTO growth_agent_steps (
          id, run_id, step, state, tool, reason, status, input, output, error, call_id, planner_model, started_at, completed_at, duration_ms
        ) VALUES (
          ${stepId(run.id, step.step)}, ${run.id}, ${step.step}, ${step.state}, ${step.tool}, ${step.reason}, ${step.status},
          ${json(step.input)}, ${json(step.output)}, ${step.error ?? null}, ${step.callId ?? null}, ${step.plannerModel ?? null},
          ${step.startedAt}, ${step.completedAt ?? null}, ${step.durationMs ?? null}
        )
        ON CONFLICT (run_id, step) DO UPDATE SET
          state = EXCLUDED.state,
          tool = EXCLUDED.tool,
          reason = EXCLUDED.reason,
          status = EXCLUDED.status,
          input = EXCLUDED.input,
          output = EXCLUDED.output,
          error = EXCLUDED.error,
          call_id = EXCLUDED.call_id,
          planner_model = EXCLUDED.planner_model,
          started_at = EXCLUDED.started_at,
          completed_at = EXCLUDED.completed_at,
          duration_ms = EXCLUDED.duration_ms
      `;
    }
  });
}

function mapRun(row: Record<string, unknown>, steps: Array<Record<string, unknown>>): GrowthAgentRun {
  return {
    id: String(row.id),
    objective: String(row.objective),
    campaignId: String(row.campaign_id),
    maxSpendPaise: row.max_spend_paise === null ? null : Number(row.max_spend_paise),
    maxSteps: Number(row.max_steps),
    state: String(row.state) as GrowthAgentRun["state"],
    stepCount: Number(row.step_count),
    plannerCalls: Number(row.planner_calls),
    plannerModel: typeof row.planner_model === "string" ? row.planner_model : undefined,
    lastPlannerError: typeof row.last_planner_error === "string" ? row.last_planner_error : undefined,
    selectedOpportunity: parseJson(row.selected_opportunity) as GrowthAgentRun["selectedOpportunity"],
    preparedOffer: parseJson(row.prepared_offer) as GrowthAgentRun["preparedOffer"],
    trace: steps.map((step) => ({
      step: Number(step.step),
      state: String(step.state) as GrowthAgentTraceStep["state"],
      tool: String(step.tool) as GrowthAgentTraceStep["tool"],
      reason: String(step.reason),
      status: String(step.status) as GrowthAgentTraceStep["status"],
      input: parseJson(step.input) as Record<string, unknown>,
      output: step.output === null ? undefined : parseJson(step.output),
      error: typeof step.error === "string" ? step.error : undefined,
      callId: typeof step.call_id === "string" ? step.call_id : undefined,
      plannerModel: typeof step.planner_model === "string" ? step.planner_model : undefined,
      startedAt: new Date(String(step.started_at)).toISOString(),
      completedAt: step.completed_at === null ? undefined : new Date(String(step.completed_at)).toISOString(),
      durationMs: step.duration_ms === null ? undefined : Number(step.duration_ms),
    })),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    completedAt: row.completed_at === null ? undefined : new Date(String(row.completed_at)).toISOString(),
  };
}

async function loadRows(runId?: string): Promise<GrowthAgentRun[]> {
  const sql = getClient();
  if (!sql) return [];
  await ensureSchema();
  const runs = runId
    ? await sql`SELECT * FROM growth_agent_runs WHERE id = ${runId}`
    : await sql`SELECT * FROM growth_agent_runs ORDER BY created_at DESC LIMIT 100`;
  if (!runs.length) return [];
  const ids = runs.map((row) => String(row.id));
  const steps = await sql`SELECT * FROM growth_agent_steps WHERE run_id = ANY(${ids}) ORDER BY run_id, step ASC`;
  return runs.map((row) => mapRun(row as Record<string, unknown>, steps.filter((step) => String(step.run_id) === String(row.id)) as unknown as Array<Record<string, unknown>>));
}

export async function loadPersistedGrowthAgentRun(runId: string): Promise<GrowthAgentRun | undefined> {
  return (await loadRows(runId))[0];
}

export async function listPersistedGrowthAgentRuns(): Promise<GrowthAgentRun[]> {
  return loadRows();
}
