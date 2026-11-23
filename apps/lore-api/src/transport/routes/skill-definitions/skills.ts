import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { Pool } from "pg";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import {
  fromRow,
  selectList,
  type DbRow,
} from "@re-cinq/lore-shared/lib/row.js";
import { packManagedNames } from "@re-cinq/lore-shared/project/settings/pack-sync-store.js";
import { hasValidHelpBlock } from "@re-cinq/lore-shared/agent-defaults/skill-help-block.js";
import {
  SKILL_DEFINITION_COLUMNS,
  SKILL_DEFINITION_TABLE,
  SKILL_NAME,
  SkillDefinitionSchema,
  type SkillDefinition,
} from "@re-cinq/lore-shared/models/skill-definition.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { OkTrue } from "../../http/ok-schema.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

// Org-level skill definitions (specs/org-skills FR-006); the per-repo route is deferred.

const BASE = "/api/skill-definitions";

const SkillBody = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  model: z.string().nullable().default(null),
  content: z.string().refine(hasValidHelpBlock, {
    message: "must carry a lore-help block with a Summary and a Usage line",
  }),
  enabled: z.boolean().optional(),
});

const SkillCreateBody = SkillBody.extend({
  name: z.string().regex(SKILL_NAME),
});

type SkillWrite = z.infer<typeof SkillCreateBody>;

const RETURNING = `RETURNING ${selectList(SKILL_DEFINITION_COLUMNS)}`;

const LIST_SQL = `SELECT ${selectList(SKILL_DEFINITION_COLUMNS)} FROM ${SKILL_DEFINITION_TABLE}
   WHERE project_id IS NULL ORDER BY name`;

const CREATE_SQL = `INSERT INTO ${SKILL_DEFINITION_TABLE} (name, title, description, model, content, enabled)
   VALUES ($1, $2, $3, $4, $5, COALESCE($6, true))
   ON CONFLICT (name) WHERE project_id IS NULL DO NOTHING ${RETURNING}`;

const UPDATE_SQL = `UPDATE ${SKILL_DEFINITION_TABLE}
   SET title = $2, description = $3, model = $4, content = $5, enabled = COALESCE($6, enabled), updated_at = now()
   WHERE name = $1 AND project_id IS NULL ${RETURNING}`;

const DELETE_SQL = `DELETE FROM ${SKILL_DEFINITION_TABLE}
   WHERE name = $1 AND project_id IS NULL RETURNING name`;

/** A skill and whether the client's pack owns it: a pack-managed skill is read-only (specs/client-packs). */
const PackAwareSkillSchema = SkillDefinitionSchema.extend({
  pack_managed: z.boolean(),
});
const SkillsListSchema = z.object({ skills: z.array(PackAwareSkillSchema) });
const SkillWrittenSchema = z.object({
  ok: OkTrue,
  skill: SkillDefinitionSchema,
});
const SkillDeletedSchema = z.object({ ok: OkTrue, deleted: z.string() });

type SkillFields = z.infer<typeof SkillBody>;

/** A write whose RETURNING row is the stored skill; no row is the given refusal. */
interface SkillWriteQuery {
  sql: string;
  name: string;
  skill: SkillFields;
  refusal: (message: string) => Error;
  message: string;
}

const NameParam = z.object({ name: z.string() });

const CREATE_OPTIONS = zodResponse(
  {
    ...bearerScope("admin"),
    validate: { payload: zodValidate(SkillCreateBody) },
  },
  SkillWrittenSchema,
  {
    name: "SkillDefinitionCreated",
    description: "Create an org-level skill definition",
    errors: [400, 409],
  },
);

const UPDATE_OPTIONS = zodResponse(
  {
    ...bearerScope("admin"),
    validate: {
      params: zodValidate(NameParam),
      payload: zodValidate(SkillBody),
    },
  },
  SkillWrittenSchema,
  {
    name: "SkillDefinitionUpdated",
    description: "Replace an org-level skill definition",
    errors: [400, 404, 409],
  },
);

const DELETE_OPTIONS = zodResponse(
  { ...bearerScope("admin"), validate: { params: zodValidate(NameParam) } },
  SkillDeletedSchema,
  {
    name: "SkillDefinitionDeleted",
    description: "Delete an org-level skill definition",
    errors: [404, 409],
  },
);

export function skillDefinitionsRoutes(
  getPool: () => Pool | null,
): ServerRoute[] {
  return [
    listRoute(getPool),
    createRoute(getPool),
    updateRoute(getPool),
    deleteRoute(getPool),
  ];
}

function listRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: BASE,
    options: zodResponse(bearerScope("read"), SkillsListSchema, {
      name: "SkillDefinitionsList",
      description: "The org-level skill definitions",
    }),
    handler: async () => ({ skills: await listedSkills(poolOf(getPool)) }),
  };
}

async function listedSkills(pool: Pool) {
  const { rows } = await pool.query(LIST_SQL);
  const packSkills = await packManagedNames(pool, "skills");

  return rows.map(toSkill).map((skill) => ({
    ...skill,
    pack_managed: packSkills.includes(skill.name),
  }));
}

function createRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: BASE,
    options: CREATE_OPTIONS,
    handler: async (request) => {
      const skill = request.payload as SkillWrite;
      const stored = await writtenSkill(poolOf(getPool), {
        sql: CREATE_SQL,
        name: skill.name,
        skill,
        refusal: apiError(409),
        message: `skill ${skill.name} already exists`,
      });

      return { ok: true, skill: stored };
    },
  };
}

function updateRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "PUT",
    path: `${BASE}/{name}`,
    options: UPDATE_OPTIONS,
    handler: async (request) => {
      const { name } = request.params;
      const pool = poolOf(getPool);

      await enforceNotPackManaged(pool, name);
      const stored = await writtenSkill(pool, {
        sql: UPDATE_SQL,
        name,
        skill: request.payload as SkillFields,
        refusal: apiError(404),
        message: `no skill named ${name}`,
      });

      return { ok: true, skill: stored };
    },
  };
}

function deleteRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "DELETE",
    path: `${BASE}/{name}`,
    options: DELETE_OPTIONS,
    handler: async (request) => {
      const { name } = request.params;
      const pool = poolOf(getPool);

      await enforceNotPackManaged(pool, name);
      const { rowCount } = await pool.query(DELETE_SQL, [name]);

      enforceTrue(rowCount, apiError(404), `no skill named ${name}`);

      return { ok: true, deleted: name };
    },
  };
}

/** A pack-managed skill is the pack repo's to change (specs/client-packs). */
async function enforceNotPackManaged(pool: Pool, name: string): Promise<void> {
  enforceTrue(
    !(await packManagedNames(pool, "skills")).includes(name),
    apiError(409),
    "pack_managed",
  );
}

function poolOf(getPool: () => Pool | null): Pool {
  const pool = getPool();

  enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

  return pool;
}

async function writtenSkill(
  pool: Pool,
  query: SkillWriteQuery,
): Promise<SkillDefinition> {
  const { skill } = query;
  const { rows } = await pool.query(query.sql, [
    query.name,
    skill.title,
    skill.description,
    skill.model,
    skill.content,
    skill.enabled,
  ]);

  enforceTrue(rows[0], query.refusal, query.message);

  return toSkill(rows[0]);
}

function toSkill(row: DbRow): SkillDefinition {
  return fromRow<SkillDefinition>(SKILL_DEFINITION_COLUMNS, row);
}
