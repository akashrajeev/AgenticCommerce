import postgres from "postgres";

export type GrowthExperimentCohort = "treatment" | "control";

export type GrowthExperiment = {
  experimentId: string;
  campaignId: string;
  name: string;
  objective: string;
  createdAt: string;
};

export type GrowthExperimentAssignment = {
  experimentId: string;
  transactionId: string;
  cohort: GrowthExperimentCohort;
  campaignId: string;
  sourceProductId: string;
  targetProductId?: string;
  assignedAt: string;
};

const DATABASE_URL = process.env.DATABASE_URL?.trim() || "";
const PERSISTENCE_DISABLED = process.env.GROWTH_EXPERIMENT_PERSISTENCE_DISABLED === "1";

let client: ReturnType<typeof postgres> | undefined;
let schemaReady: Promise<void> | undefined;

function getClient() {
  if (process.env.GROWTH_EXPERIMENT_PERSISTENCE_DISABLED === "1") return undefined;
  if (PERSISTENCE_DISABLED) return undefined;
  if (!DATABASE_URL) throw new Error("GROWTH_EXPERIMENT_PERSISTENCE_NOT_CONFIGURED");
  if (!client) client = postgres(DATABASE_URL, { max: 2, connect_timeout: 5, idle_timeout: 20, prepare: false });
  return client;
}

async function ensureSchema(): Promise<void> {
  const sql = getClient();
  if (!sql) return;
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS growth_experiments (
        experiment_id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        name TEXT NOT NULL,
        objective TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS growth_experiments_campaign_created_idx ON growth_experiments(campaign_id, created_at DESC)`;
      await sql`CREATE TABLE IF NOT EXISTS growth_experiment_assignments (
        experiment_id TEXT NOT NULL REFERENCES growth_experiments(experiment_id) ON DELETE CASCADE,
        transaction_id TEXT PRIMARY KEY,
        cohort TEXT NOT NULL CHECK (cohort IN ('treatment', 'control')),
        campaign_id TEXT NOT NULL,
        source_product_id TEXT NOT NULL,
        target_product_id TEXT,
        assigned_at TIMESTAMPTZ NOT NULL,
        CONSTRAINT growth_experiment_assignment_key UNIQUE (experiment_id, transaction_id)
      )`;
      await sql`CREATE INDEX IF NOT EXISTS growth_experiment_assignments_experiment_cohort_idx ON growth_experiment_assignments(experiment_id, cohort, assigned_at)`;
    })().catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  await schemaReady;
}

export async function createGrowthExperiment(experiment: GrowthExperiment): Promise<GrowthExperiment> {
  const sql = getClient();
  if (!sql) return experiment;
  await ensureSchema();
  await sql`
    INSERT INTO growth_experiments (experiment_id, campaign_id, name, objective, created_at)
    VALUES (${experiment.experimentId}, ${experiment.campaignId}, ${experiment.name}, ${experiment.objective}, ${experiment.createdAt})
    ON CONFLICT (experiment_id) DO UPDATE SET
      campaign_id = EXCLUDED.campaign_id,
      name = EXCLUDED.name,
      objective = EXCLUDED.objective
  `;
  return experiment;
}

export async function deleteGrowthExperiment(experimentId: string): Promise<void> {
  const sql = getClient();
  if (!sql) return;
  await ensureSchema();
  await sql`DELETE FROM growth_experiments WHERE experiment_id = ${experimentId}`;
}

export async function assignGrowthExperimentMembers(assignments: GrowthExperimentAssignment[]): Promise<void> {
  if (!assignments.length) return;
  const sql = getClient();
  if (!sql) return;
  await ensureSchema();
  await sql.begin(async (transaction) => {
    for (const assignment of assignments) {
      await transaction`
        INSERT INTO growth_experiment_assignments (
          experiment_id, transaction_id, cohort, campaign_id, source_product_id, target_product_id, assigned_at
        ) VALUES (
          ${assignment.experimentId}, ${assignment.transactionId}, ${assignment.cohort}, ${assignment.campaignId},
          ${assignment.sourceProductId}, ${assignment.targetProductId ?? null}, ${assignment.assignedAt}
        )
        ON CONFLICT (transaction_id) DO UPDATE SET
          cohort = EXCLUDED.cohort,
          campaign_id = EXCLUDED.campaign_id,
          source_product_id = EXCLUDED.source_product_id,
          target_product_id = EXCLUDED.target_product_id,
          assigned_at = EXCLUDED.assigned_at
        WHERE growth_experiment_assignments.experiment_id = EXCLUDED.experiment_id
      `;
    }
  });
}

function mapAssignment(row: Record<string, unknown>): GrowthExperimentAssignment {
  return {
    experimentId: String(row.experiment_id),
    transactionId: String(row.transaction_id),
    cohort: String(row.cohort) as GrowthExperimentCohort,
    campaignId: String(row.campaign_id),
    sourceProductId: String(row.source_product_id),
    ...(typeof row.target_product_id === "string" ? { targetProductId: row.target_product_id } : {}),
    assignedAt: new Date(String(row.assigned_at)).toISOString(),
  };
}

export async function getGrowthExperiment(experimentId: string): Promise<GrowthExperiment | undefined> {
  const sql = getClient();
  if (!sql) return undefined;
  await ensureSchema();
  const rows = await sql<Record<string, unknown>[]>`SELECT experiment_id, campaign_id, name, objective, created_at FROM growth_experiments WHERE experiment_id = ${experimentId}`;
  const row = rows[0];
  if (!row) return undefined;
  return {
    experimentId: String(row.experiment_id),
    campaignId: String(row.campaign_id),
    name: String(row.name),
    objective: String(row.objective),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

export async function listGrowthExperiments(): Promise<GrowthExperiment[]> {
  const sql = getClient();
  if (!sql) return [];
  await ensureSchema();
  const rows = await sql<Record<string, unknown>[]>`SELECT experiment_id, campaign_id, name, objective, created_at FROM growth_experiments ORDER BY created_at DESC LIMIT 50`;
  return rows.map((row) => ({
    experimentId: String(row.experiment_id),
    campaignId: String(row.campaign_id),
    name: String(row.name),
    objective: String(row.objective),
    createdAt: new Date(String(row.created_at)).toISOString(),
  }));
}

export async function listGrowthExperimentAssignments(experimentId: string): Promise<GrowthExperimentAssignment[]> {
  const sql = getClient();
  if (!sql) return [];
  await ensureSchema();
  const rows = await sql<Record<string, unknown>[]>`
    SELECT experiment_id, transaction_id, cohort, campaign_id, source_product_id, target_product_id, assigned_at
    FROM growth_experiment_assignments
    WHERE experiment_id = ${experimentId}
    ORDER BY assigned_at ASC
  `;
  return rows.map(mapAssignment);
}

export async function getGrowthExperimentAssignmentsByTransactionIds(transactionIds: string[]): Promise<GrowthExperimentAssignment[]> {
  const sql = getClient();
  if (!sql || !transactionIds.length) return [];
  await ensureSchema();
  const rows = await sql<Record<string, unknown>[]>`
    SELECT experiment_id, transaction_id, cohort, campaign_id, source_product_id, target_product_id, assigned_at
    FROM growth_experiment_assignments
    WHERE transaction_id = ANY(${transactionIds})
  `;
  return rows.map(mapAssignment);
}
