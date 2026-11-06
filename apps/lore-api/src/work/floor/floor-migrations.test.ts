import { describe, expect, it } from "vitest";
import { shippedFloorAgents } from "@re-cinq/lore-shared/project/agents/pipeline-agents.js";
import {
  readFloorMigrations,
  runFloorMigrations,
  type FloorMigrationDeps,
  type NamedFloorMigration,
} from "./floor-migrations.js";

function migration(version: string, agent: string): NamedFloorMigration {
  return {
    version,
    migrate: ({ updatePrompt }) => updatePrompt(agent, `${agent}.md`),
  };
}

function deps(
  migrations: NamedFloorMigration[],
  applied: string[] = [],
  refused: string[] = [],
) {
  const written: string[] = [];
  const marked: string[] = [];
  const migrationDeps: FloorMigrationDeps = {
    migrations: () => Promise.resolve(migrations),
    applied: () => Promise.resolve(applied),
    floor: {
      updatePrompt: (agent, file) => {
        if (refused.includes(agent)) {
          return Promise.reject(new Error(`floor refused ${agent}`));
        }

        written.push(`${agent} <- ${file}`);

        return Promise.resolve();
      },
      updateTimeout: () => Promise.resolve(),
    },
    markApplied: (version) => {
      marked.push(version);

      return Promise.resolve();
    },
  };

  return { migrationDeps, written, marked };
}

describe("runFloorMigrations", () => {
  it("runs floor/0001 not yet applied and records it", async () => {
    const { migrationDeps, written, marked } = deps([
      migration("floor/0001_a", "loop-dod"),
    ]);

    const outcome = await runFloorMigrations(migrationDeps);

    expect({ written, marked, outcome }).toEqual({
      written: ["loop-dod <- loop-dod.md"],
      marked: ["floor/0001_a"],
      outcome: { applied: ["floor/0001_a"], failed: null },
    });
  });

  it("skips floor/0001 when the ledger already holds it and runs floor/0002", async () => {
    const { migrationDeps, written, marked } = deps(
      [
        migration("floor/0002_b", "loop-sync"),
        migration("floor/0001_a", "loop-dod"),
      ],
      ["floor/0001_a"],
    );

    await runFloorMigrations(migrationDeps);

    expect({ written, marked }).toEqual({
      written: ["loop-sync <- loop-sync.md"],
      marked: ["floor/0002_b"],
    });
  });

  it("stops at floor/0001 when the floor refuses it, leaving floor/0002 for the next boot", async () => {
    const { migrationDeps, written, marked } = deps(
      [
        migration("floor/0001_a", "loop-dod"),
        migration("floor/0002_b", "loop-sync"),
      ],
      [],
      ["loop-dod"],
    );

    const outcome = await runFloorMigrations(migrationDeps);

    expect({ written, marked, outcome }).toEqual({
      written: [],
      marked: [],
      outcome: {
        applied: [],
        failed: { name: "floor/0001_a", reason: "floor refused loop-dod" },
      },
    });
  });
});

describe("readFloorMigrations", () => {
  it("names floor/0001 to floor/0005, whose every prompt and timeout comes from a shipped agent file", async () => {
    const shipped = shippedFloorAgents();
    const written = await everyWrite();

    expect({
      versions: written.versions,
      unshipped: written.writes.filter(
        ({ field, file }) => !shipped.get(file.replace(/\.md$/, ""))?.[field],
      ),
    }).toEqual({
      versions: [
        "floor/0001_loop_agents_assemble_context",
        "floor/0002_loop_agents_read_brief",
        "floor/0003_spec_links_carry_content_hash",
        "floor/0004_spec_tickets_tested_missing_reason",
        "floor/0005_spec_write_timeout",
      ],
      unshipped: [],
    });
  });
});

describe("floor/0005_spec_write_timeout", () => {
  it("writes spec-write's shipped 30-minute timeout to the floor, and no prompt", async () => {
    const shipped = shippedFloorAgents().get("spec-write");
    const { writes } = await everyWrite("floor/0005_spec_write_timeout");

    expect({ shipped: shipped?.timeout_minutes, writes }).toEqual({
      shipped: 30,
      writes: [
        {
          field: "timeout_minutes",
          agent: "spec-write",
          file: "spec-write.md",
        },
      ],
    });
  });
});

interface Write {
  field: "prompt" | "timeout_minutes";
  agent: string;
  file: string;
}

async function everyWrite(only?: string) {
  const writes: Write[] = [];
  const migrations = (await readFloorMigrations()).filter(
    (named) => only === undefined || named.version === only,
  );
  const record = (field: Write["field"]) => (agent: string, file: string) => {
    writes.push({ field, agent, file });

    return Promise.resolve();
  };

  for (const { migrate } of migrations) {
    await migrate({
      updatePrompt: record("prompt"),
      updateTimeout: record("timeout_minutes"),
    });
  }

  return { versions: migrations.map((named) => named.version), writes };
}
