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
}
