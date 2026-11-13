import { describe, expect, it } from "vitest";
import type { PgPool } from "../domain/memory-store-types.js";
import { parseSkillFile } from "./skill-file.js";
import { loadSkillDefaults } from "./skill-defaults-files.js";
import {
  applySkillRevisions,
  SKILL_REVISIONS,
  type SkillRevision,
} from "./skill-revisions.js";

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

function ledgerPool(recordedVersions: string[]): {
  pool: PgPool;
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const pool: PgPool = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      const isLedgerRead = sql.includes("SELECT version");

      return {
        rows: isLedgerRead
          ? recordedVersions.map((version) => ({ version }))
          : [],
      } as { rows: never[] };
    },
  };

  return { pool, queries };
}

const SAMPLE_SKILL = parseSkillFile(
  "sample",
  `---
name: sample
description: Does a sample thing.
model: claude-haiku-4-5-20251001
---

# Sample Title

## Help
`,
);
const OTHER_SKILL = parseSkillFile("other", "# Other\n");
const REVISION: SkillRevision = {
  version: "skills/0001_sample",
  names: ["sample"],
};

describe("applySkillRevisions", () => {
  it("returns the version and writes the shipped fields when the revision is not recorded", async () => {
    const { pool, queries } = ledgerPool([]);

    const applied = await applySkillRevisions(
      pool,
      [SAMPLE_SKILL, OTHER_SKILL],
      [REVISION],
    );

    expect({
      applied,
      writes: queries
        .filter((query) => !query.sql.includes("SELECT version"))
        .map((query) => query.params),
    }).toEqual({
      applied: ["skills/0001_sample"],
      writes: [
        [
          "skills/0001_sample",
          ["sample"],
          ["Sample Title"],
          ["Does a sample thing."],
          ["claude-haiku-4-5-20251001"],
          [SAMPLE_SKILL.content],
        ],
      ],
    });
  });

  it("changes nothing when the revision is already recorded", async () => {
    const { pool, queries } = ledgerPool(["skills/0001_sample"]);

    const applied = await applySkillRevisions(pool, [SAMPLE_SKILL], [REVISION]);

    expect({ applied, queries: queries.length }).toEqual({
      applied: [],
      queries: 1,
    });
  });

  it("updates only the org row and leaves enabled alone in the single statement that also records the version", async () => {
    const { pool, queries } = ledgerPool([]);

    await applySkillRevisions(pool, [SAMPLE_SKILL], [REVISION]);

    const writeSql =
      queries.find((query) => !query.sql.includes("SELECT version"))?.sql ?? "";

    expect({
      updatesOrgRows:
        /UPDATE lore\.skill_definitions/.test(writeSql) &&
        /project_id IS NULL/.test(writeSql),
      recordsVersion: /INSERT INTO lore\.schema_migrations/.test(writeSql),
      touchesEnabled: /enabled/.test(writeSql),
      insertsSkills: /INSERT INTO lore\.skill_definitions/.test(writeSql),
    }).toEqual({
      updatesOrgRows: true,
      recordsVersion: true,
      touchesEnabled: false,
      insertsSkills: false,
    });
  });

  it("throws before any write when a revision names a skill that is not shipped", async () => {
    const { pool, queries } = ledgerPool([]);

    await expect(
      applySkillRevisions(pool, [OTHER_SKILL], [REVISION]),
    ).rejects.toThrow(
      new Error("Revision skills/0001_sample names unshipped skill sample"),
    );
    expect(
      queries.filter((query) => !query.sql.includes("SELECT version")),
    ).toEqual([]);
  });

  it("returns every shipped revision version when the shipped skills are applied to an empty ledger", async () => {
    const { pool } = ledgerPool([]);

    const applied = await applySkillRevisions(pool, loadSkillDefaults());

    expect(applied).toEqual(
      SKILL_REVISIONS.map((revision) => revision.version),
    );
  });
});
