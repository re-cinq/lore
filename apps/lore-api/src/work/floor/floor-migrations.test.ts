import { afterEach, describe, expect, it, vi } from "vitest";
import { shippedFloorAgents } from "@re-cinq/lore-shared/project/agents/pipeline-agents.js";
import { InMemoryAgentDefinitions } from "@re-cinq/lore-shared/project/agents/agent-defs-floor.fixture.js";
import { FloorAgentDefs } from "@re-cinq/lore-shared/project/agents/agent-defs-floor.js";
import {
  floorApiFor,
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
      updateSkills: () => Promise.resolve(),
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
  it("names floor/0001 to floor/0007, whose every prompt, timeout and skills list comes from a shipped agent file", async () => {
    const shipped = shippedFloorAgents();
    const written = await everyWrite();

    expect({
      versions: written.versions,
      unshipped: written.writes.filter(
        ({ field, file }) => !shippedValue(shipped, field, file),
      ),
    }).toEqual({
      versions: [
        "floor/0001_loop_agents_assemble_context",
        "floor/0002_loop_agents_read_brief",
        "floor/0003_spec_links_carry_content_hash",
        "floor/0004_spec_tickets_tested_missing_reason",
        "floor/0005_spec_write_timeout",
        "floor/0006_spec_tickets_settled_statements",
        "floor/0007_station_skills",
        "floor/0008_plan_agents_read_user_story",
        "floor/0009_plan_sketches_downstream",
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

  it("raises spec-write's timeout on the floor to 30 minutes and keeps its model, prompt, image, config and every repo's variant", async () => {
    const floor = new InMemoryAgentDefinitions();
    const saved = {
      settings: {
        model: "claude-opus-4-7",
        prompt: "Write the section.",
        image: "ghcr.io/re-cinq/agent:1",
        timeoutMinutes: 15,
        config: { skills: ["lore-context"] },
      },
      variants: { "github.com/re-cinq/lore": { model: "gemini-3.1-pro" } },
    };

    await floor.put("spec-write", saved);
    const [timeout] = (await readFloorMigrations()).filter(
      (named) => named.version === "floor/0005_spec_write_timeout",
    );

    await timeout!.migrate(floorApiFor(new FloorAgentDefs(floor)));

    expect((await floor.get("spec-write"))?.body).toEqual({
      ...saved,
      settings: { ...saved.settings, timeoutMinutes: 30 },
    });
  });
});

describe("floor/0007_station_skills", () => {
  it("writes the skills of the seven stations the migration names, and nothing else", async () => {
    const { writes } = await everyWrite("floor/0007_station_skills");

    expect(writes.map(({ field, agent }) => `${field} ${agent}`)).toEqual(
      [
        "loop-tdd-round",
        "loop-dod",
        "loop-fix-ci",
        "code-review",
        "code-review-recheck",
        "triage-reproduce",
        "plan-analyze",
      ].map((agent) => `skills ${agent}`),
    );
  });
});

describe("floor/0008_plan_agents_read_user_story", () => {
  it("writes the shipped prompts of plan-analyze and plan-validate, and nothing else", async () => {
    const { writes } = await everyWrite(
      "floor/0008_plan_agents_read_user_story",
    );

    expect(writes.map(({ field, agent }) => `${field} ${agent}`)).toEqual([
      "prompt plan-analyze",
      "prompt plan-validate",
    ]);
  });
});

describe("floor/0009_plan_sketches_downstream", () => {
  it("writes the shipped prompts of plan-analyze, spec-draft, spec-rework and spec-tickets-decompose, and nothing else", async () => {
    const { writes } = await everyWrite("floor/0009_plan_sketches_downstream");

    expect(writes.map(({ field, agent }) => `${field} ${agent}`)).toEqual([
      "prompt plan-analyze",
      "prompt spec-draft",
      "prompt spec-rework",
      "prompt spec-tickets-decompose",
    ]);
  });
});

describe("updateSkills", () => {
  afterEach(() => vi.unstubAllEnvs());

  const saved = {
    settings: {
      model: "claude-opus-4-7",
      prompt: "Review the pull request.",
      image: "ghcr.io/re-cinq/agent:1",
      timeoutMinutes: 15,
      config: {
        skills: ["lore-context", "tdd-loop"],
        skills_source: "https://old.example/skills",
        mcp_servers: [{ name: "lore" }],
        pod_resources: { memory: "2Gi" },
      },
    },
    variants: {
      "github.com/re-cinq/lore": {
        config: { skills: ["cli-design"] },
      },
    },
  };

  async function updated(body: Parameters<InMemoryAgentDefinitions["put"]>[1]) {
    const floor = new InMemoryAgentDefinitions();

    await floor.put("code-review", body);
    await floorApiFor(new FloorAgentDefs(floor)).updateSkills(
      "code-review",
      "code-review.md",
    );

    return (await floor.get("code-review"))?.body;
  }

  it("replaces the org default's skills with the shipped list and keeps everything else", async () => {
    vi.stubEnv("LORE_SKILLS_URL", "https://new.example/skills");

    expect(await updated(saved)).toEqual({
      ...saved,
      settings: {
        ...saved.settings,
        config: {
          ...saved.settings.config,
          skills: ["lore-context", "testing"],
        },
      },
    });
  });

  it("gives an org default with no skills_source the one LORE_SKILLS_URL names", async () => {
    vi.stubEnv("LORE_SKILLS_URL", "https://new.example/skills");
    const { skills_source: _kept, ...configWithoutSource } =
      saved.settings.config;

    const body = await updated({
      ...saved,
      settings: { ...saved.settings, config: configWithoutSource },
    });

    expect((body as typeof saved).settings.config.skills_source).toBe(
      "https://new.example/skills",
    );
  });

  it("throws for a file no shipped agent has", async () => {
    const api = floorApiFor(new FloorAgentDefs(new InMemoryAgentDefinitions()));

    await expect(api.updateSkills("ghost", "ghost.md")).rejects.toThrow(
      new Error("no shipped agent file ghost.md has a skills list"),
    );
  });

  it("throws for a shipped file with no skills list", async () => {
    const api = floorApiFor(new FloorAgentDefs(new InMemoryAgentDefinitions()));

    await expect(api.updateSkills("loop-sync", "loop-sync.md")).rejects.toThrow(
      new Error("no shipped agent file loop-sync.md has a skills list"),
    );
  });
});

interface Write {
  field: "prompt" | "timeout_minutes" | "skills";
  agent: string;
  file: string;
}

function shippedValue(
  shipped: ReturnType<typeof shippedFloorAgents>,
  field: Write["field"],
  file: string,
): unknown {
  const agent = shipped.get(file.replace(/\.md$/, ""));

  return field === "skills" ? agent?.config?.skills : agent?.[field];
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
      updateSkills: record("skills"),
    });
  }

  return { versions: migrations.map((named) => named.version), writes };
}
