import { describe, expect, it } from "vitest";
import { shippedAgentPrompts } from "@re-cinq/lore-shared/project/agents/pipeline-agents.js";
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
  it("names floor/0001_loop_agents_assemble_context, whose every file is a shipped prompt", async () => {
    const prompts = shippedAgentPrompts();
    const files: string[] = [];
    const migrations = await readFloorMigrations();

    for (const { migrate } of migrations) {
      await migrate({
        updatePrompt: (_agent, file) => {
          files.push(file);

          return Promise.resolve();
        },
      });
    }

    expect({
      versions: migrations.map((named) => named.version),
      unshipped: files.filter(
        (file) => !prompts.get(file.replace(/\.md$/, "")),
      ),
    }).toEqual({
      versions: ["floor/0001_loop_agents_assemble_context"],
      unshipped: [],
    });
  });
});
