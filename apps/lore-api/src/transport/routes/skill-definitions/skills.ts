import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { Pool } from "pg";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import {
  SkillDefinitionSchema,
  SKILL_DEFINITION_COLUMNS,
  SKILL_DEFINITION_TABLE,
} from "@re-cinq/lore-shared/models/skill-definition.js";
import { OkTrue } from "../../http/ok-schema.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import { selectList, fromRow } from "@re-cinq/lore-shared/lib/row.js";
import type { SkillDefinition } from "@re-cinq/lore-shared/models/skill-definition.js";

const BASE = "/api/skill-definitions";

const SkillsListResponse = z.object({
  skills: z.array(SkillDefinitionSchema),
});

const SkillWrittenSchema = z.object({
  ok: OkTrue,
});

const SkillDeletedSchema = z.object({
  ok: OkTrue,
  deleted: z.string(),
});

export function skillDefinitionsRoutes(
  getPool: () => Pool | null,
): ServerRoute[] {
  return [
    {
      method: "GET",
      path: BASE,
      options: zodResponse(bearerScope("read"), SkillsListResponse, {
        name: "SkillDefinitionsList",
        description: "List org-level skill definitions",
      }),
      handler: async (_request, h) => {
        const pool = getPool();
        enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
        const res = await pool.query(
          `SELECT ${selectList(SKILL_DEFINITION_COLUMNS)} FROM ${SKILL_DEFINITION_TABLE} WHERE project_id IS NULL`,
        );

        const skills = res.rows.map((row) =>
          fromRow<SkillDefinition>(SKILL_DEFINITION_COLUMNS, row),
        );
        return h.response({ skills });
      },
    },
    {
      method: "POST",
      path: BASE,
      options: zodResponse(bearerScope("admin"), SkillWrittenSchema, {
        name: "SkillDefinitionCreated",
        description: "Create a new org-level skill definition",
      }),
      handler: async (request, h) => {
        const pool = getPool();
        enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

        const payload = request.payload as Record<string, any>;

        await pool.query(
          `INSERT INTO ${SKILL_DEFINITION_TABLE} (name, title, description, model, content, enabled, project_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (name) WHERE project_id IS NULL DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           model = EXCLUDED.model,
           content = EXCLUDED.content,
           enabled = EXCLUDED.enabled`,
          [
            payload.name,
            payload.title,
            payload.description,
            payload.model || null,
            payload.content,
            payload.enabled !== undefined ? payload.enabled : true,
            null,
          ],
        );

        return h.response({ ok: true }).code(200);
      },
    },
    {
      method: "PUT",
      path: `${BASE}/{name}`,
      options: zodResponse(bearerScope("admin"), SkillWrittenSchema, {
        name: "SkillDefinitionUpdated",
        description: "Update an org-level skill definition",
      }),
      handler: async (request, h) => {
        const pool = getPool();
        enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

        const name = request.params.name;
        const payload = request.payload as Record<string, any>;

        const updates: string[] = [];
        const values: any[] = [name];
        let idx = 2;

        if (payload.title !== undefined) {
          updates.push(`title = $${idx++}`);
          values.push(payload.title);
        }
        if (payload.description !== undefined) {
          updates.push(`description = $${idx++}`);
          values.push(payload.description);
        }
        if (payload.model !== undefined) {
          updates.push(`model = $${idx++}`);
          values.push(payload.model);
        }
        if (payload.content !== undefined) {
          updates.push(`content = $${idx++}`);
          values.push(payload.content);
        }
        if (payload.enabled !== undefined) {
          updates.push(`enabled = $${idx++}`);
          values.push(payload.enabled);
        }

        if (updates.length > 0) {
          await pool.query(
            `UPDATE ${SKILL_DEFINITION_TABLE} SET ${updates.join(", ")} WHERE name = $1 AND project_id IS NULL`,
            values,
          );
        }

        return h.response({ ok: true }).code(200);
      },
    },
    {
      method: "DELETE",
      path: `${BASE}/{name}`,
      options: zodResponse(bearerScope("admin"), SkillDeletedSchema, {
        name: "SkillDefinitionDeleted",
        description: "Delete an org-level skill definition",
      }),
      handler: async (request, h) => {
        const pool = getPool();
        enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

        const name = request.params.name;

        await pool.query(
          `DELETE FROM ${SKILL_DEFINITION_TABLE} WHERE name = $1 AND project_id IS NULL`,
          [name],
        );

        return h.response({ ok: true, deleted: name }).code(200);
      },
    },
  ];
}
