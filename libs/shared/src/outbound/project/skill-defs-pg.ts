import type { PgPool } from "../memory-store.js";
import type { SkillDef, SkillDefsReadPort } from "./skill-defs-port.js";

const RESOLVE_SQL = `
  SELECT name, title, description, model, content, enabled, project_id
  FROM lore.skill_definitions
  WHERE name = $1
    AND (project_id = $2 OR project_id IS NULL)
`;

function mergeRows(
  project: SkillDef | null,
  org: SkillDef | null,
): SkillDef | null {
  const top = project ?? org;

  if (!top) {
    return null;
  }

  return applyOverrides(top, project, org);
}

function applyOverrides(
  top: SkillDef,
  project: SkillDef | null,
  org: SkillDef | null,
): SkillDef {
  return mergeWithPartials(
    top,
    (project ?? {}) as Partial<SkillDef>,
    (org ?? {}) as Partial<SkillDef>,
  );
}

function mergeWithPartials(
  top: SkillDef,
  project: Partial<SkillDef>,
  org: Partial<SkillDef>,
): SkillDef {
  return {
    name: top.name,
    title: pick(project.title, org.title) ?? top.title,
    description: pick(project.description, org.description),
    model: pick(project.model, org.model),
    content: pick(project.content, org.content) ?? top.content,
    enabled: pick(project.enabled, org.enabled) ?? top.enabled,
    project_id: project.project_id ?? null,
  };
}

function pick<T>(a: T | null | undefined, b: T | null | undefined): T | null {
  if (a !== null && a !== undefined) {
    return a;
  }

  if (b !== null && b !== undefined) {
    return b;
  }

  return null;
}

export class PgSkillDefs implements SkillDefsReadPort {
  constructor(private readonly pool: PgPool) {}

  async resolve(repo: string, name: string): Promise<SkillDef | null> {
    const { rows } = await this.pool.query<SkillDef>(RESOLVE_SQL, [name, repo]);
    const typed = rows as SkillDef[];
    const project = typed.find((r) => r.project_id !== null) ?? null;
    const org = typed.find((r) => r.project_id === null) ?? null;

    return mergeRows(project, org);
  }
}
