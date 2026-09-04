import postgres from "postgres";

type BuyerAgentRunSnapshot = {
  id: string;
  objective: string;
  maxSpendPaise: number;
  currency: "INR";
  maxSteps: number;
  state: string;
  stepCount: number;
  plannerCalls: number;
  plannerModel?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

type BuyerAgentTraceStep = {
  step: number;
  state: string;
  tool: string;
  arguments: Record<string, unknown>;
  status: string;
  reason?: string;
  output?: unknown;
  error?: string;
  callId?: string;
  plannerModel?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
};

let client: ReturnType<typeof postgres> | undefined;
let schemaReady: Promise<void> | undefined;

function getClient() {
  if (process.env.BUYER_AGENT_PERSISTENCE_DISABLED === "1") return undefined;
  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) throw new Error("BUYER_AGENT_PERSISTENCE_NOT_CONFIGURED");
  if (!client) client = postgres(databaseUrl, { max: 1, connect_timeout: 5, idle_timeout: 20, prepare: false });
  return client;
}

async function ensureSchema(): Promise<void> {
  const sql = getClient();
  if (!sql) return;
  if (!schemaReady) {
    schemaReady = sql`
      CREATE TABLE IF NOT EXISTS buyer_agent_runs (
        id TEXT PRIMARY KEY,
        objective TEXT NOT NULL,
        max_spend_paise BIGINT NOT NULL,
        currency TEXT NOT NULL,
        max_steps INTEGER NOT NULL,
        state TEXT NOT NULL,
        step_count INTEGER NOT NULL,
        planner_calls INTEGER NOT NULL,
        planner_model TEXT,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS buyer_agent_steps (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES buyer_agent_runs(id) ON DELETE CASCADE,
        step INTEGER NOT NULL,
        state TEXT NOT NULL,
        tool TEXT NOT NULL,
        reason TEXT,
        status TEXT NOT NULL,
        arguments JSONB NOT NULL,
        output JSONB,
        error TEXT,
        call_id TEXT,
        planner_model TEXT,
        started_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        duration_ms INTEGER,
        CONSTRAINT buyer_agent_steps_run_step_key UNIQUE (run_id, step)
      );
      CREATE INDEX IF NOT EXISTS buyer_agent_steps_run_started_idx ON buyer_agent_steps(run_id, started_at);
      CREATE INDEX IF NOT EXISTS buyer_agent_runs_updated_idx ON buyer_agent_runs(updated_at DESC);
    `.then(() => undefined).catch((error) => {
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
  try { return JSON.parse(value); } catch { return value; }
}

function stepId(runId: string, step: number): string {
  return `${runId}:step:${step}`;
}

export async function persistBuyerAgentCheckpoint(run: BuyerAgentRunSnapshot, step?: BuyerAgentTraceStep): Promise<void> {
  const sql = getClient();
  if (!sql) return;
  await ensureSchema();
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO buyer_agent_runs (
        id, objective, max_spend_paise, currency, max_steps, state, step_count, planner_calls,
        planner_model, last_error, created_at, updated_at, completed_at
      ) VALUES (
        ${run.id}, ${run.objective}, ${run.maxSpendPaise}, ${run.currency}, ${run.maxSteps}, ${run.state}, ${run.stepCount}, ${run.plannerCalls},
        ${run.plannerModel ?? null}, ${run.lastError ?? null}, ${run.createdAt}, ${run.updatedAt}, ${run.completedAt ?? null}
      )
      ON CONFLICT (id) DO UPDATE SET
        objective = EXCLUDED.objective,
        max_spend_paise = EXCLUDED.max_spend_paise,
        currency = EXCLUDED.currency,
        max_steps = EXCLUDED.max_steps,
        state = EXCLUDED.state,
        step_count = EXCLUDED.step_count,
        planner_calls = EXCLUDED.planner_calls,
        planner_model = EXCLUDED.planner_model,
        last_error = EXCLUDED.last_error,
        updated_at = EXCLUDED.updated_at,
        completed_at = EXCLUDED.completed_at
    `;
    if (step) {
      await tx`
        INSERT INTO buyer_agent_steps (
          id, run_id, step, state, tool, reason, status, arguments, output, error, call_id, planner_model,
          started_at, completed_at, duration_ms
        ) VALUES (
          ${stepId(run.id, step.step)}, ${run.id}, ${step.step}, ${step.state}, ${step.tool}, ${step.reason ?? null}, ${step.status},
          ${json(step.arguments)}, ${json(step.output)}, ${step.error ?? null}, ${step.callId ?? null}, ${step.plannerModel ?? null},
          ${step.startedAt}, ${step.completedAt ?? null}, ${step.durationMs ?? null}
        )
        ON CONFLICT (run_id, step) DO UPDATE SET
          state = EXCLUDED.state,
          tool = EXCLUDED.tool,
          reason = EXCLUDED.reason,
          status = EXCLUDED.status,
          arguments = EXCLUDED.arguments,
          output = EXCLUDED.output,
          error = EXCLUDED.error,
          call_id = EXCLUDED.call_id,
          planner_model = EXCLUDED.planner_model,
          completed_at = EXCLUDED.completed_at,
          duration_ms = EXCLUDED.duration_ms
      `;
    }
  });
}

export async function loadBuyerAgentRun(runId: string): Promise<{ run: BuyerAgentRunSnapshot; trace: BuyerAgentTraceStep[] } | undefined> {
  const sql = getClient();
  if (!sql) return undefined;
  await ensureSchema();
  const rows = await sql`SELECT * FROM buyer_agent_runs WHERE id = ${runId}`;
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const steps = await sql`SELECT * FROM buyer_agent_steps WHERE run_id = ${runId} ORDER BY step ASC`;
  const run: BuyerAgentRunSnapshot = {
    id: String(row.id), objective: String(row.objective), maxSpendPaise: Number(row.max_spend_paise), currency: "INR",
    maxSteps: Number(row.max_steps), state: String(row.state), stepCount: Number(row.step_count), plannerCalls: Number(row.planner_calls),
    plannerModel: typeof row.planner_model === "string" ? row.planner_model : undefined,
    lastError: typeof row.last_error === "string" ? row.last_error : undefined,
    createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(),
    completedAt: row.completed_at === null ? undefined : new Date(String(row.completed_at)).toISOString(),
  };
  const trace = steps.map((step) => ({
    step: Number(step.step), state: String(step.state), tool: String(step.tool), reason: typeof step.reason === "string" ? step.reason : undefined,
    status: String(step.status), arguments: (parseJson(step.arguments) ?? {}) as Record<string, unknown>, output: step.output === null ? undefined : parseJson(step.output),
    error: typeof step.error === "string" ? step.error : undefined, callId: typeof step.call_id === "string" ? step.call_id : undefined,
    plannerModel: typeof step.planner_model === "string" ? step.planner_model : undefined,
    startedAt: new Date(String(step.started_at)).toISOString(), completedAt: step.completed_at === null ? undefined : new Date(String(step.completed_at)).toISOString(),
    durationMs: step.duration_ms === null ? undefined : Number(step.duration_ms),
  }));
  return { run, trace };
}
