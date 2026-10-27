import { describe, expect, it } from "vitest";
import type { PgPool } from "../domain/memory-store-types.js";
import { parseSkillFile } from "./skill-file.js";
import { seedSkillDefaults } from "./skill-defaults-seed.js";

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

function recordingPool(): { pool: PgPool; queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  const pool: PgPool = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });

      return { rows: [] };
    },
  };

  return { pool, queries };
}

const VALID_SKILL = `---
name: sample
description: Does a sample thing.
---

# Sample

## Help

<!-- lore-help:begin -->
**Summary.** Does a sample thing.
**Usage:** \`/sample\`
<!-- lore-help:end -->
`;

describe("seedSkillDefaults", () => {
  it("upserts the whole skill file verbatim as content when the skill has a valid Help block", async () => {
    const { pool, queries } = recordingPool();

    await seedSkillDefaults(pool, [parseSkillFile("sample", VALID_SKILL)]);

    expect(queries.map((query) => query.params)).toEqual([
      [
        "sample",
        "Sample",
        "Does a sample thing.",
        null,
        VALID_SKILL,
        true,
        null,
      ],
    ]);
  });

  it("throws before any query when one skill lacks a Help block", async () => {
    const { pool, queries } = recordingPool();
    const skills = [
      parseSkillFile("sample", VALID_SKILL),
      parseSkillFile("bare", "# Bare\n"),
    ];

    await expect(seedSkillDefaults(pool, skills)).rejects.toThrow(
      new Error("Skill bare is missing a valid ## Help block"),
    );
    expect(queries).toEqual([]);
  });
});
