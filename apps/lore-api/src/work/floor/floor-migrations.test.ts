import { afterEach, describe, expect, it, vi } from "vitest";
import { readFloorPipelineFiles } from "./seed-floor-pipelines.js";
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
      updateEnv: () => Promise.resolve(),
      updateModel: () => Promise.resolve(),
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
  it("names floor/0001 to floor/0015, whose every prompt, timeout, skills list, env and model comes from a shipped agent file", async () => {
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
        "floor/0010_refine_acts_on_thread_outcome",
        "floor/0011_spec_tickets_decompose_leaves_closed_tickets",
        "floor/0012_spec_tickets_decompose_scoped_tasks",
        "floor/0013_ticket_agents_search_first",
        "floor/0014_commit_author_from_settings",
        "floor/0015_models_from_loop_bench",
        "floor/0016_round_closes_test_gaps_first",
        "floor/0017_review_agents_read_paged_packets",
        "floor/0018_review_agents_diff_first_and_guard",
      ],
      unshipped: [],
    });
  });
});

describe("every floor migration", () => {
  it("writes only agents a shipped pipeline names, since the floor holds no other and one refused write stops every later migration", async () => {
    const named = new Set(
      (await readFloorPipelineFiles()).flatMap(({ text }) =>
        [...text.matchAll(/agent_definition: ([\w-]+)/g)].map(
          ([, agent]) => agent,
        ),
      ),
    );
    const { writes } = await everyWrite();

    expect(
      writes.filter(({ agent }) => !named.has(agent)).map(({ agent }) => agent),
    ).toEqual([]);
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

describe("floor/0010_refine_acts_on_thread_outcome", () => {
  it("writes the shipped prompts of plan-sketch and plan-analyze, and nothing else", async () => {
    const { writes } = await everyWrite(
      "floor/0010_refine_acts_on_thread_outcome",
    );

    expect(writes.map(({ field, agent }) => `${field} ${agent}`)).toEqual([
      "prompt plan-sketch",
      "prompt plan-analyze",
    ]);
  });
});

describe("floor/0011_spec_tickets_decompose_leaves_closed_tickets", () => {
  it("writes the shipped prompt of spec-tickets-decompose, and nothing else", async () => {
    const { writes } = await everyWrite(
      "floor/0011_spec_tickets_decompose_leaves_closed_tickets",
    );

    expect(writes.map(({ field, agent }) => `${field} ${agent}`)).toEqual([
      "prompt spec-tickets-decompose",
    ]);
  });
});

describe("floor/0012_spec_tickets_decompose_scoped_tasks", () => {
  it("writes the shipped prompt of spec-tickets-decompose again, and nothing else", async () => {
    const { writes } = await everyWrite(
      "floor/0012_spec_tickets_decompose_scoped_tasks",
    );

    expect(writes.map(({ field, agent }) => `${field} ${agent}`)).toEqual([
      "prompt spec-tickets-decompose",
    ]);
  });
});

describe("floor/0013_ticket_agents_search_first", () => {
  it("writes the shipped prompts of spec-tickets-decompose and triage-decompose, and nothing else", async () => {
    const { writes } = await everyWrite(
      "floor/0013_ticket_agents_search_first",
    );

    expect(writes.map(({ field, agent }) => `${field} ${agent}`)).toEqual([
      "prompt spec-tickets-decompose",
      "prompt triage-decompose",
    ]);
  });
});

describe("floor/0014_commit_author_from_settings", () => {
  it("writes the shipped prompt and env of the five agents that commit and a pipeline names, and nothing else", async () => {
    const { writes } = await everyWrite(
      "floor/0014_commit_author_from_settings",
    );

    expect(writes.map(({ field, agent }) => `${field} ${agent}`)).toEqual(
      [
        "loop-dod",
        "loop-fix-ci",
        "loop-tdd-round",
        "spec-draft",
        "spec-rework",
      ].flatMap((agent) => [`prompt ${agent}`, `env ${agent}`]),
    );
  });
});

describe("floor/0015_models_from_loop_bench", () => {
  it("writes the shipped model of the thirteen agents loop-bench picked, and nothing else", async () => {
    const { writes } = await everyWrite("floor/0015_models_from_loop_bench");

    expect(writes.map(({ field, agent }) => `${field} ${agent}`)).toEqual(
      [
        "loop-tdd-round",
        "spec-upkeep-update-specs",
        "onboard-author",
        "loop-fix-ci",
        "loop-sync",
        "onboard-fix-ci",
        "spec-upkeep-fix-ci",
        "loop-dod",
        "spec-qa-generate",
        "spec-qa-answer",
        "spec-qa-recheck",
        "spec-draft",
        "spec-tickets-decompose",
      ].map((agent) => `model ${agent}`),
    );
  });
});

describe("floor/0016_round_closes_test_gaps_first", () => {
  it("writes the shipped prompt of loop-tdd-round, and nothing else", async () => {
    const { writes } = await everyWrite(
      "floor/0016_round_closes_test_gaps_first",
    );

    expect(writes.map(({ field, agent }) => `${field} ${agent}`)).toEqual([
      "prompt loop-tdd-round",
    ]);
  });
});

describe("floor/0017_review_agents_read_paged_packets", () => {
  it("writes the shipped prompts of the five review pass agents, and nothing else", async () => {
    const { writes } = await everyWrite(
      "floor/0017_review_agents_read_paged_packets",
    );

    expect(writes.map(({ field, agent }) => `${field} ${agent}`)).toEqual([
      "prompt shadow-review-reader",
      "prompt shadow-compare-intent",
      "prompt shadow-review-challenge",
      "prompt shadow-review-product",
      "prompt code-review-product",
    ]);
  });
});

describe("floor/0018_review_agents_diff_first_and_guard", () => {
  it("writes the shipped prompt and skills of the five review pass agents, and nothing else", async () => {
    const { writes } = await everyWrite(
      "floor/0018_review_agents_diff_first_and_guard",
    );

    expect(writes.map(({ field, agent }) => `${field} ${agent}`)).toEqual(
      [
        "shadow-review-reader",
        "shadow-compare-intent",
        "shadow-review-challenge",
        "shadow-review-product",
        "code-review-product",
      ].flatMap((agent) => [`prompt ${agent}`, `skills ${agent}`]),
    );
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

describe("updateModel", () => {
  const saved = {
    settings: {
      model: "gemini-4-argon",
      prompt: "Fix the build.",
      image: "ghcr.io/re-cinq/agent:1",
      timeoutMinutes: 45,
      prices: {
        "gemini-4-argon": { inputPerMillion: 2, outputPerMillion: 10 },
      },
      config: { skills: ["lore-context"] },
    },
    variants: { "github.com/re-cinq/lore": { timeoutMinutes: 60 } },
  };

  async function updated(agent: string, body: typeof saved) {
    const floor = new InMemoryAgentDefinitions();

    await floor.put(agent, body);
    await floorApiFor(new FloorAgentDefs(floor)).updateModel(
      agent,
      `${agent}.md`,
    );

    return (await floor.get(agent))?.body;
  }

  it("writes loop-fix-ci's shipped gemini-4-carbon and its prices, and keeps the prompt, image, config and every repo's variant", async () => {
    expect(await updated("loop-fix-ci", saved)).toEqual({
      ...saved,
      settings: {
        ...saved.settings,
        model: "gemini-4-carbon",
        prices: {
          "gemini-4-carbon": {
            inputPerMillion: 4,
            outputPerMillion: 20,
            cacheReadPerMillion: 0.4,
          },
        },
      },
    });
  });

  it("writes loop-tdd-round's shipped claude-sonnet-5-5 and drops the prices it ships none of", async () => {
    const { prices: _dropped, ...settings } = {
      ...saved.settings,
      model: "claude-sonnet-5-5",
    };

    expect(await updated("loop-tdd-round", saved)).toEqual({
      ...saved,
      settings,
    });
  });

  it("throws no shipped agent file ghost.md has a model for an agent no file ships", async () => {
    const api = floorApiFor(new FloorAgentDefs(new InMemoryAgentDefinitions()));

    await expect(api.updateModel("ghost", "ghost.md")).rejects.toThrow(
      new Error("no shipped agent file ghost.md has a model"),
    );
  });
});

describe("updateEnv", () => {
  const author = {
    LORE_COMMIT_AUTHOR_NAME: "Acme Bot",
    LORE_COMMIT_AUTHOR_EMAIL: "bot@acme.example",
  };
  const saved = {
    settings: {
      model: "claude-opus-4-7",
      prompt: "Round the tests.",
      image: "ghcr.io/re-cinq/agent:1",
      timeoutMinutes: 15,
      config: {
        skills: ["lore-context"],
        env: { LORE_BRANCH_TESTS: "/workspace/target", GIT_AUTHOR_NAME: "Old" },
      },
    },
  };

  it("adds the shipped env with the environment filled in to the org default's env and keeps the env it already has", async () => {
    const floor = new InMemoryAgentDefinitions();

    await floor.put("loop-tdd-round", saved);
    await floorApiFor(new FloorAgentDefs(floor), author).updateEnv(
      "loop-tdd-round",
      "loop-tdd-round.md",
    );

    expect((await floor.get("loop-tdd-round"))?.body).toEqual({
      ...saved,
      settings: {
        ...saved.settings,
        config: {
          ...saved.settings.config,
          env: {
            LORE_BRANCH_TESTS: "/workspace/target",
            GIT_AUTHOR_NAME: "Acme Bot",
            GIT_AUTHOR_EMAIL: "bot@acme.example",
            GIT_COMMITTER_NAME: "Acme Bot",
            GIT_COMMITTER_EMAIL: "bot@acme.example",
          },
        },
      },
    });
  });

  it("throws naming the variable when the environment lacks one the shipped env names", async () => {
    const api = floorApiFor(
      new FloorAgentDefs(new InMemoryAgentDefinitions()),
      {},
    );

    await expect(
      api.updateEnv("loop-tdd-round", "loop-tdd-round.md"),
    ).rejects.toThrow(
      new Error("LORE_COMMIT_AUTHOR_NAME is not set, and a pipeline names it"),
    );
  });

  it("throws for a shipped file with no env", async () => {
    const api = floorApiFor(new FloorAgentDefs(new InMemoryAgentDefinitions()));

    await expect(api.updateEnv("loop-sync", "loop-sync.md")).rejects.toThrow(
      new Error("no shipped agent file loop-sync.md has an env"),
    );
  });
});

interface Write {
  field: "prompt" | "timeout_minutes" | "skills" | "env" | "model";
  agent: string;
  file: string;
}

function shippedValue(
  shipped: ReturnType<typeof shippedFloorAgents>,
  field: Write["field"],
  file: string,
): unknown {
  const agent = shipped.get(file.replace(/\.md$/, ""));

  return field === "skills" || field === "env"
    ? agent?.config?.[field]
    : agent?.[field];
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
      updateEnv: record("env"),
      updateModel: record("model"),
    });
  }

  return { versions: migrations.map((named) => named.version), writes };
}
