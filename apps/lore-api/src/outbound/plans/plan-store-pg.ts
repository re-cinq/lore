import type { Pool } from "pg";
import { z } from "zod";
import type {
  Approval,
  PlanDocument,
  PlanMeta,
} from "@re-cinq/planning-document";
import {
  PlanNotFoundError,
  type MetaPatch,
  type NewPlan,
  type PlanStore,
  type PlanVersion,
  type PlanVersionSummary,
  type StoredProjection,
  type StoredState,
  type VersionReason,
} from "@re-cinq/planning-sync";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  fromRow,
  selectList,
  type DbRow,
} from "@re-cinq/lore-shared/lib/row.js";
import {
  PLAN_COLUMNS,
  PLAN_TABLE,
  type Plan,
} from "@re-cinq/lore-shared/models/plan.js";
import { PLAN_STATE_TABLE } from "@re-cinq/lore-shared/models/plan-state.js";
import {
  PLAN_VERSION_COLUMNS,
  PLAN_VERSION_TABLE,
  type PlanVersionRow,
} from "@re-cinq/lore-shared/models/plan-version.js";

/** The pool, read per call: lore-api builds its server before the pool exists. */
export type Db = () => Pool;

const PLAN_SELECT = selectList(PLAN_COLUMNS);
const VERSION_SELECT = selectList(PLAN_VERSION_COLUMNS);

const INSERT_PLAN = `INSERT INTO ${PLAN_TABLE} (repo, title, type, created_by)
  VALUES ($1, $2, $3, $4) RETURNING ${PLAN_SELECT}`;
const SELECT_PLAN = `SELECT ${PLAN_SELECT} FROM ${PLAN_TABLE} WHERE id = $1`;
const SELECT_STATE = `SELECT state FROM ${PLAN_STATE_TABLE} WHERE plan_id = $1`;
const UPSERT_STATE = `INSERT INTO ${PLAN_STATE_TABLE} (plan_id, state, json, content_hash)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (plan_id) DO UPDATE SET state = EXCLUDED.state, json = EXCLUDED.json,
    content_hash = EXCLUDED.content_hash, updated_at = now()`;
const SELECT_PROJECTION = `SELECT s.json, s.content_hash, p.current_version
  FROM ${PLAN_STATE_TABLE} s JOIN ${PLAN_TABLE} p ON p.id = s.plan_id
  WHERE s.plan_id = $1`;
const INSERT_VERSION = `INSERT INTO ${PLAN_VERSION_TABLE} (${VERSION_SELECT})
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;
const SELECT_VERSIONS = `SELECT ${VERSION_SELECT} FROM ${PLAN_VERSION_TABLE}
  WHERE plan_id = $1 ORDER BY version`;
const SELECT_VERSION = `SELECT ${VERSION_SELECT} FROM ${PLAN_VERSION_TABLE}
  WHERE plan_id = $1 AND version = $2`;
const SELECT_REPO_PLANS = `SELECT ${PLAN_SELECT} FROM ${PLAN_TABLE}
  WHERE repo = $1 ORDER BY updated_at DESC`;
const DELETE_PLAN = `DELETE FROM ${PLAN_TABLE} WHERE id = $1`;

// The columns a MetaPatch field is stored in.
const PATCH_COLUMNS: Record<keyof MetaPatch, string> = {
  title: PLAN_COLUMNS.title,
  status: PLAN_COLUMNS.status,
  approval: PLAN_COLUMNS.approval,
  version: PLAN_COLUMNS.currentVersion,
};

const PLAN_ID = z.uuid();

/** The planning-sync PlanStore on lore.plans / plan_state / plan_versions; checked by the library's own checkPlanStore. */
export function pgPlanStore(db: Db): PlanStore {
  return {
    createPlan: (input) => createPlan(db, input),
    getMeta: (planId) => getMeta(db, planId),
    updateMeta: (planId, patch) => updateMeta(db, planId, patch),
    loadState: (planId) => loadState(db, planId),
    storeState: (input) => storeState(db, input),
    loadProjection: (planId) => loadProjection(db, planId),
    appendVersion: (version) => appendVersion(db, version),
    listVersions: (planId) => listVersions(db, planId),
    getVersion: (planId, number) => getVersion(db, planId, number),
  };
}

/** The plans of one repo, most recently changed first. */
export async function listPlanMetas(db: Db, repo: string): Promise<PlanMeta[]> {
  return (await rows(db, SELECT_REPO_PLANS, [repo])).map(metaOf);
}

/** Removes the plan for good; its state, versions and collab tokens go with it (ON DELETE CASCADE). */
export async function deletePlan(db: Db, planId: string): Promise<void> {
  await planRows(db, planId, DELETE_PLAN);
}

async function createPlan(db: Db, input: NewPlan): Promise<PlanMeta> {
  const [row] = await rows(db, INSERT_PLAN, [
    input.repo,
    input.title,
    input.type,
    input.createdBy,
  ]);

  return metaOf(row);
}

async function getMeta(db: Db, planId: string): Promise<PlanMeta | null> {
  const row = await planRow(db, planId, SELECT_PLAN);

  return row ? metaOf(row) : null;
}

async function updateMeta(
  db: Db,
  planId: string,
  patch: MetaPatch,
): Promise<PlanMeta> {
  const { text, params } = patchStatement(patch);
  const row = await planRow(db, planId, text, params);

  enforceTrue(row, PlanNotFoundError, `unknown plan ${planId}`);

  return metaOf(row);
}

// An UPDATE of just the patched fields; $1 is the plan id.
function patchStatement(patch: MetaPatch): { text: string; params: unknown[] } {
  const fields = (Object.keys(PATCH_COLUMNS) as (keyof MetaPatch)[]).filter(
    (field) => patch[field] !== undefined,
  );
  const sets = fields.map(
    (field, index) => `${PATCH_COLUMNS[field]} = $${index + 2}`,
  );

  return {
    text: `UPDATE ${PLAN_TABLE} SET ${[...sets, "updated_at = now()"].join(", ")}
      WHERE id = $1 RETURNING ${PLAN_SELECT}`,
    params: fields.map((field) => patch[field]),
  };
}

async function loadState(db: Db, planId: string): Promise<Uint8Array | null> {
  const row = await planRow(db, planId, SELECT_STATE);

  return row ? (row.state as Uint8Array) : null;
}

async function storeState(db: Db, stored: StoredState): Promise<void> {
  await rows(db, UPSERT_STATE, [
    stored.planId,
    Buffer.from(stored.state),
    stored.json,
    stored.contentHash,
  ]);
}

async function loadProjection(
  db: Db,
  planId: string,
): Promise<StoredProjection | null> {
  const row = await planRow(db, planId, SELECT_PROJECTION);

  return row
    ? {
        json: row.json as PlanDocument,
        contentHash: String(row.content_hash),
        version: Number(row.current_version),
      }
    : null;
}

async function appendVersion(db: Db, version: PlanVersion): Promise<void> {
  await rows(db, INSERT_VERSION, [
    version.planId,
    version.number,
    version.reason,
    version.createdBy,
    version.createdAt,
    version.contentHash,
    version.json,
    Buffer.from(version.state),
  ]);
}

async function listVersions(
  db: Db,
  planId: string,
): Promise<PlanVersionSummary[]> {
  const found = await planRows(db, planId, SELECT_VERSIONS);

  return found.map((row) => summaryOf(versionOf(row)));
}

async function getVersion(
  db: Db,
  planId: string,
  number: number,
): Promise<PlanVersion | null> {
  const row = await planRow(db, planId, SELECT_VERSION, [number]);

  return row ? versionOf(row) : null;
}

function metaOf(row: DbRow): PlanMeta {
  const plan = fromRow<Plan>(PLAN_COLUMNS, row);

  return {
    schemaVersion: 1,
    id: plan.id,
    repo: plan.repo,
    type: plan.type as PlanMeta["type"],
    templateVersion: plan.templateVersion,
    title: plan.title,
    status: plan.status as PlanMeta["status"],
    approval: plan.approval as Approval | null,
    version: plan.currentVersion,
    createdBy: plan.createdBy,
    updatedAt: plan.updatedAt.toISOString(),
  };
}

function versionOf(row: DbRow): PlanVersion {
  const version = fromRow<PlanVersionRow>(PLAN_VERSION_COLUMNS, row);

  return {
    ...version,
    reason: version.reason as VersionReason,
    createdAt: version.createdAt.toISOString(),
    json: version.json as PlanDocument,
  };
}

function summaryOf({
  json: _json,
  state: _state,
  ...summary
}: PlanVersion): PlanVersionSummary {
  return summary;
}

// Plan ids are uuids; any other id names no plan, rather than failing Postgres's uuid cast.
async function planRows(
  db: Db,
  planId: string,
  text: string,
  params: unknown[] = [],
): Promise<DbRow[]> {
  return PLAN_ID.safeParse(planId).success
    ? rows(db, text, [planId, ...params])
    : [];
}

async function planRow(
  db: Db,
  planId: string,
  text: string,
  params: unknown[] = [],
): Promise<DbRow | undefined> {
  return (await planRows(db, planId, text, params)).at(0);
}

async function rows(db: Db, text: string, params: unknown[]): Promise<DbRow[]> {
  return (await db().query<DbRow>(text, params)).rows;
}
