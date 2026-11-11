import { enforceTrue } from "../lib/enforce.js";
import type { PgPool } from "../domain/memory-store-types.js";
import type { SkillFile } from "./skill-file.js";

export interface SkillRevision {
  version: string;
  names: string[];
}

export const SKILL_REVISIONS: SkillRevision[] = [
  {
    version: "skills/0001_trim_and_repair",
    names: [
      "api-design",
      "check-tests",
      "cli-design",
      "domain-driven-design",
      "event-sourcing",
      "front-end-testing",
      "functional",
      "hexagonal-architecture",
      "improve-codebase-architecture",
      "legacy-find-missing-tests",
      "mutation-testing",
      "observability",
      "react-testing",
      "structure-codebase",
      "tdd-start",
      "test-design-reviewer",
      "testing",
      "twelve-factor",
      "ubiquitous-language",
    ],
  },
  {
    version: "skills/0002_open_source_attribution",
    names: [
      "api-design",
      "cli-design",
      "domain-driven-design",
      "event-sourcing",
      "front-end-testing",
      "functional",
      "hexagonal-architecture",
      "improve-codebase-architecture",
      "mutation-testing",
      "observability",
      "react-testing",
      "structure-codebase",
      "test-design-reviewer",
      "testing",
      "twelve-factor",
      "typescript-strict",
      "ubiquitous-language",
    ],
  },
];

const RECORDED_VERSIONS_SQL =
  "SELECT version FROM lore.schema_migrations WHERE version LIKE 'skills/%'";

const REPLACE_ORG_ROWS_AND_RECORD_SQL = `
    WITH replaced AS (
      UPDATE lore.skill_definitions AS stored
      SET title = shipped.title,
          description = shipped.description,
          model = shipped.model,
          content = shipped.content,
          updated_at = now()
      FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
        AS shipped(name, title, description, model, content)
      WHERE stored.project_id IS NULL AND stored.name = shipped.name
    )
    INSERT INTO lore.schema_migrations (version) VALUES ($1)
    ON CONFLICT (version) DO NOTHING
    `;

export async function applySkillRevisions(
  pool: PgPool,
  skills: SkillFile[],
  revisions: SkillRevision[] = SKILL_REVISIONS,
): Promise<string[]> {
  const recorded = await recordedVersions(pool);
  const pending = revisions.filter(
    (revision) => !recorded.has(revision.version),
  );
  const shippedByName = new Map(skills.map((skill) => [skill.name, skill]));
  const writes = pending.map((revision) => ({
    version: revision.version,
    shipped: shippedSkillsOf(revision, shippedByName),
  }));

  for (const write of writes) {
    await replaceOrgRows(pool, write);
  }

  return pending.map((revision) => revision.version);
}

async function recordedVersions(pool: PgPool): Promise<Set<string>> {
  const { rows } = await pool.query<{ version: string }>(RECORDED_VERSIONS_SQL);

  return new Set(rows.map((row) => row.version));
}

function shippedSkillsOf(
  revision: SkillRevision,
  shippedByName: Map<string, SkillFile>,
): SkillFile[] {
  return revision.names.map((name) => {
    const skill = shippedByName.get(name);

    enforceTrue(
      skill !== undefined,
      Error,
      `Revision ${revision.version} names unshipped skill ${name}`,
    );

    return skill;
  });
}

async function replaceOrgRows(
  pool: PgPool,
  { version, shipped }: { version: string; shipped: SkillFile[] },
): Promise<void> {
  await pool.query(REPLACE_ORG_ROWS_AND_RECORD_SQL, [
    version,
    shipped.map((skill) => skill.name),
    shipped.map((skill) => skill.title),
    shipped.map((skill) => skill.description),
    shipped.map((skill) => skill.model),
    shipped.map((skill) => skill.content),
  ]);
}
