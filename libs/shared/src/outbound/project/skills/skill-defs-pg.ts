import type { PgPool } from "../../memory-store.js";
import { fromRow, selectList, type DbRow } from "../../../lib/row.js";
import {
  SKILL_DEFINITION_COLUMNS,
  SKILL_DEFINITION_TABLE,
  type SkillDefinition,
} from "../../../domain/models/skill-definition.js";

export interface SkillDefsReadPort {
  resolve(repo: string, name: string): Promise<SkillDefinition | null>;
}

const RESOLVE_SKILL_SQL = `SELECT ${selectList(SKILL_DEFINITION_COLUMNS, "s")}
    FROM ${SKILL_DEFINITION_TABLE} s
    LEFT JOIN lore.repos r ON r.id = s.project_id
   WHERE s.name = $1 AND (s.project_id IS NULL OR r.full_name = $2)`;

/** Project row over org row; the one optional field, model, falls through to the org row when the project leaves it unset. */
export function resolveSkill(
  project: SkillDefinition | null,
  org: SkillDefinition | null,
): SkillDefinition | null {
  if (!project) {
    return org;
  }

  return { ...project, model: project.model ?? org?.model ?? null };
}

const ORG_SKILL_SQL = `SELECT ${selectList(SKILL_DEFINITION_COLUMNS)}
    FROM ${SKILL_DEFINITION_TABLE} WHERE name = $1 AND project_id IS NULL`;

const PUT_ORG_SKILL_SQL = `INSERT INTO ${SKILL_DEFINITION_TABLE} (name, title, description, model, content, enabled)
    VALUES ($1, $2, $3, $4, $5, true)
    ON CONFLICT (name) WHERE project_id IS NULL DO UPDATE SET title = EXCLUDED.title,
      description = EXCLUDED.description, model = EXCLUDED.model, content = EXCLUDED.content, updated_at = now()`;

const DELETE_ORG_SKILL_SQL = `DELETE FROM ${SKILL_DEFINITION_TABLE} WHERE name = $1 AND project_id IS NULL`;

export type OrgSkillWrite = Omit<SkillDefinition, "enabled" | "projectId">;

export class PgSkillDefs implements SkillDefsReadPort {
  constructor(private readonly pool: PgPool) {}

  async resolve(repo: string, name: string): Promise<SkillDefinition | null> {
    const { rows } = await this.pool.query<DbRow>(RESOLVE_SKILL_SQL, [
      name,
      repo,
    ]);
    const defs = rows.map((row) =>
      fromRow<SkillDefinition>(SKILL_DEFINITION_COLUMNS, row),
    );

    return resolveSkill(
      defs.find((def) => def.projectId !== null) ?? null,
      defs.find((def) => def.projectId === null) ?? null,
    );
  }

  async orgSkill(name: string): Promise<SkillDefinition | null> {
    const { rows } = await this.pool.query<DbRow>(ORG_SKILL_SQL, [name]);

    return rows[0]
      ? fromRow<SkillDefinition>(SKILL_DEFINITION_COLUMNS, rows[0])
      : null;
  }

  /** A new row is enabled; an existing one keeps its flag. */
  async putOrgSkill(skill: OrgSkillWrite): Promise<void> {
    await this.pool.query(PUT_ORG_SKILL_SQL, [
      skill.name,
      skill.title,
      skill.description,
      skill.model,
      skill.content,
    ]);
  }

  async deleteOrgSkill(name: string): Promise<void> {
    await this.pool.query(DELETE_ORG_SKILL_SQL, [name]);
  }
}
