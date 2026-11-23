import { describe, expect, it } from "vitest";
import { applyPack } from "./apply-pack.js";
import {
  ACME_REVIEW_TEXT,
  EXTENDED_REVIEWER,
  skillText,
  SHIPPED_TDD_START,
  EXTENSION,
  fakePack,
  SHIPPED_REVIEWER,
  TRIAGE_AGENT_TEXT,
  TRIAGE_PIPELINE_TEXT,
  CODE_REVIEW_PIPELINE_TEXT,
} from "./pack-fakes.fixtures.js";

describe("applyPack", () => {
  it("puts the extended agent on the floor and records the commit it applied", async () => {
    const pack = fakePack();

    pack.files = [EXTENSION];
    pack.floorAgents.set("reviewer", SHIPPED_REVIEWER);

    const result = await applyPack(pack.deps());

    expect({
      result,
      reviewer: pack.floorAgents.get("reviewer"),
      sync: pack.sync,
    }).toEqual({
      result: {
        status: "applied",
        commit: "c0ffee1",
        changed: ["agent/reviewer"],
      },
      reviewer: EXTENDED_REVIEWER,
      sync: {
        repo: "acme/pack",
        ref: "main",
        commit: "c0ffee1",
        applied_at: "2026-11-17T10:00:00.000Z",
        agent_count: 1,
        line_count: 0,
        extra_count: 1,
        refused_files: [],
        agents: ["reviewer"],
        pipelines: [],
        skill_count: 0,
        skills: [],
        error: null,
        error_at: null,
      },
    });
  });

  it("puts nothing a second time when the pack has not changed", async () => {
    const pack = fakePack();

    pack.files = [
      EXTENSION,
      { path: "triage/assembly-line.yaml", text: TRIAGE_PIPELINE_TEXT },
      { path: "triage/agents/triager.md", text: TRIAGE_AGENT_TEXT },
    ];
    pack.floorAgents.set("reviewer", SHIPPED_REVIEWER);
    await applyPack(pack.deps());

    const second = await applyPack(pack.deps());

    expect({ second, agentPuts: pack.agentPuts }).toEqual({
      second: { status: "applied", commit: "c0ffee1", changed: [] },
      agentPuts: ["triager", "reviewer"],
    });
  });

  it("imports a pack pipeline and lists it in the sync state", async () => {
    const pack = fakePack();

    pack.files = [
      { path: "triage/assembly-line.yaml", text: TRIAGE_PIPELINE_TEXT },
      { path: "triage/agents/triager.md", text: TRIAGE_AGENT_TEXT },
    ];

    const result = await applyPack(pack.deps());

    expect({
      result,
      floor: [...pack.floorPipelines],
      listed: pack.sync?.pipelines,
    }).toEqual({
      result: {
        status: "applied",
        commit: "c0ffee1",
        changed: ["agent/triager", "assembly-lines/triage"],
      },
      floor: ["triage"],
      listed: ["triage"],
    });
  });

  it("puts the shipped agent back when the pack no longer extends it", async () => {
    const pack = fakePack();

    pack.files = [EXTENSION];
    pack.floorAgents.set("reviewer", SHIPPED_REVIEWER);
    await applyPack(pack.deps());
    pack.files = [];

    const result = await applyPack(pack.deps());

    expect({
      result,
      reviewer: pack.floorAgents.get("reviewer"),
      listed: pack.sync?.agents,
    }).toEqual({
      result: {
        status: "applied",
        commit: "c0ffee1",
        changed: ["agent/reviewer"],
      },
      reviewer: SHIPPED_REVIEWER,
      listed: [],
    });
  });

  it("leaves an agent only the pack defined as it is when the pack drops it", async () => {
    const pack = fakePack();

    pack.files = [
      { path: "triage/agents/triager.md", text: TRIAGE_AGENT_TEXT },
    ];
    await applyPack(pack.deps());
    const triager = pack.floorAgents.get("triager");

    pack.files = [];

    await applyPack(pack.deps());

    expect({
      triager: pack.floorAgents.get("triager"),
      puts: pack.agentPuts,
    }).toEqual({ triager, puts: ["triager"] });
  });

  it("archives a pipeline the pack no longer has", async () => {
    const pack = fakePack();

    pack.files = [
      { path: "triage/assembly-line.yaml", text: TRIAGE_PIPELINE_TEXT },
      { path: "triage/agents/triager.md", text: TRIAGE_AGENT_TEXT },
    ];
    await applyPack(pack.deps());
    pack.files = [];

    const result = await applyPack(pack.deps());

    expect({
      result,
      archived: pack.archived,
      floor: [...pack.floorPipelines],
      listed: pack.sync?.pipelines,
    }).toEqual({
      result: {
        status: "applied",
        commit: "c0ffee1",
        changed: ["archived/triage"],
      },
      archived: ["triage"],
      floor: [],
      listed: [],
    });
  });

  it("puts Lore's own code-review line back, not archiving it, when the pack drops its code-review/assembly-line.yaml", async () => {
    const pack = fakePack();

    pack.files = [
      {
        path: "code-review/assembly-line.yaml",
        text: CODE_REVIEW_PIPELINE_TEXT,
      },
    ];
    await applyPack(pack.deps());
    pack.files = [];

    const result = await applyPack(pack.deps());

    expect({
      result,
      archived: pack.archived,
      shippedPuts: pack.shippedPuts,
      listed: pack.sync?.pipelines,
    }).toEqual({
      result: {
        status: "applied",
        commit: "c0ffee1",
        changed: ["shipped/code-review"],
      },
      archived: [],
      shippedPuts: ["code-review"],
      listed: [],
    });
  });

  it("touches nothing when no pack is configured", async () => {
    const pack = fakePack();
    const deps = { ...pack.deps(), config: null };

    const result = await applyPack({
      ...deps,
      fetch: async () => {
        throw new Error("fetched with no pack configured");
      },
    });

    expect({ result, sync: pack.sync }).toEqual({
      result: { status: "unconfigured" },
      sync: null,
    });
  });

  it("keeps the floor and the last good state and records the error when the pack is unreachable", async () => {
    const pack = fakePack();

    pack.files = [
      EXTENSION,
      { path: "triage/assembly-line.yaml", text: TRIAGE_PIPELINE_TEXT },
      { path: "triage/agents/triager.md", text: TRIAGE_AGENT_TEXT },
    ];
    pack.floorAgents.set("reviewer", SHIPPED_REVIEWER);
    await applyPack(pack.deps());
    const applied = pack.sync;
    const floorBefore = new Map(pack.floorAgents);

    pack.unreachable = new Error("connect ETIMEDOUT github.example");
    pack.files = [];
    const result = await applyPack(pack.deps());

    expect({
      result,
      sync: pack.sync,
      agents: pack.floorAgents,
      pipelines: [...pack.floorPipelines],
      archived: pack.archived,
    }).toEqual({
      result: { status: "failed", error: "connect ETIMEDOUT github.example" },
      sync: {
        ...applied,
        error: "connect ETIMEDOUT github.example",
        error_at: "2026-11-17T10:00:00.000Z",
      },
      agents: floorBefore,
      pipelines: ["triage"],
      archived: [],
    });
  });

  it("records the error with nothing applied when the first sync cannot reach the pack", async () => {
    const pack = fakePack();

    pack.unreachable = new Error("404 Not Found");

    await applyPack(pack.deps());

    expect(pack.sync).toEqual({
      repo: "acme/pack",
      ref: "main",
      commit: null,
      applied_at: null,
      agent_count: 0,
      line_count: 0,
      extra_count: 0,
      refused_files: [],
      agents: [],
      pipelines: [],
      skill_count: 0,
      skills: [],
      error: "404 Not Found",
      error_at: "2026-11-17T10:00:00.000Z",
    });
  });

  it("records the error and keeps the last good state when the floor refuses a put", async () => {
    const pack = fakePack();

    pack.files = [
      { path: "triage/agents/triager.md", text: TRIAGE_AGENT_TEXT },
    ];
    await applyPack(pack.deps());
    const applied = pack.sync;

    pack.files = [{ path: "other/agents/other.md", text: TRIAGE_AGENT_TEXT }];
    pack.floorFailure = new Error("floor is down");
    const result = await applyPack(pack.deps());

    expect({ result, sync: pack.sync }).toEqual({
      result: { status: "failed", error: "floor is down" },
      sync: {
        ...applied,
        error: "floor is down",
        error_at: "2026-11-17T10:00:00.000Z",
      },
    });
  });

  it("keeps a pipeline whose file the pack now holds malformed, and records the refused file", async () => {
    const pack = fakePack();

    pack.files = [
      { path: "triage/assembly-line.yaml", text: TRIAGE_PIPELINE_TEXT },
      { path: "triage/agents/triager.md", text: TRIAGE_AGENT_TEXT },
    ];
    await applyPack(pack.deps());
    pack.files = [
      { path: "triage/assembly-line.yaml", text: "line: [" },
      { path: "triage/agents/triager.md", text: TRIAGE_AGENT_TEXT },
    ];

    await applyPack(pack.deps());

    expect({
      archived: pack.archived,
      floor: [...pack.floorPipelines],
      listed: pack.sync?.pipelines,
      refused: pack.sync?.refused_files.map((file) => file.path),
    }).toEqual({
      archived: [],
      floor: ["triage"],
      listed: ["triage"],
      refused: ["triage/assembly-line.yaml"],
    });
  });

  it("keeps an agent set by the last sync whose file the pack now holds malformed", async () => {
    const pack = fakePack();

    pack.files = [EXTENSION];
    pack.floorAgents.set("reviewer", SHIPPED_REVIEWER);
    await applyPack(pack.deps());
    pack.files = [
      { ...EXTENSION, path: "code-review/agents/reviewer.md", text: "oops" },
    ];

    await applyPack(pack.deps());

    expect({
      reviewer: pack.floorAgents.get("reviewer"),
      listed: pack.sync?.agents,
    }).toEqual({ reviewer: EXTENDED_REVIEWER, listed: ["reviewer"] });
  });

  it("writes acme-review to the catalogue and lists it in pack.sync skills", async () => {
    const pack = fakePack();

    pack.files = [{ path: "skills/acme-review.md", text: ACME_REVIEW_TEXT }];

    const result = await applyPack(pack.deps());

    expect({
      result,
      held: pack.catalogue.get("acme-review")?.content,
      sync: { count: pack.sync?.skill_count, skills: pack.sync?.skills },
    }).toEqual({
      result: {
        status: "applied",
        commit: "c0ffee1",
        changed: ["skill/acme-review"],
      },
      held: ACME_REVIEW_TEXT,
      sync: { count: 1, skills: ["acme-review"] },
    });
  });

  it("puts no skill a second time when skills/acme-review.md has not changed", async () => {
    const pack = fakePack();

    pack.files = [{ path: "skills/acme-review.md", text: ACME_REVIEW_TEXT }];
    await applyPack(pack.deps());

    const second = await applyPack(pack.deps());

    expect({ second, puts: pack.skillPuts }).toEqual({
      second: { status: "applied", commit: "c0ffee1", changed: [] },
      puts: ["acme-review"],
    });
  });

  it("writes the shipped tdd-start back when the pack drops skills/tdd-start.md", async () => {
    const pack = fakePack();

    pack.catalogue.set("tdd-start", SHIPPED_TDD_START);
    pack.files = [
      {
        path: "skills/tdd-start.md",
        text: skillText("TDD start", "Starts it our way."),
      },
    ];
    await applyPack(pack.deps());
    pack.files = [];

    const result = await applyPack(pack.deps());

    expect({
      changed: result.status === "applied" ? result.changed : [],
      held: pack.catalogue.get("tdd-start"),
      listed: pack.sync?.skills,
    }).toEqual({
      changed: ["shipped-skill/tdd-start"],
      held: SHIPPED_TDD_START,
      listed: [],
    });
  });

  it("deletes acme-review when the pack drops skills/acme-review.md", async () => {
    const pack = fakePack();

    pack.files = [{ path: "skills/acme-review.md", text: ACME_REVIEW_TEXT }];
    await applyPack(pack.deps());
    pack.files = [];

    const result = await applyPack(pack.deps());

    expect({
      changed: result.status === "applied" ? result.changed : [],
      removals: pack.skillRemovals,
      held: [...pack.catalogue.keys()],
    }).toEqual({
      changed: ["removed-skill/acme-review"],
      removals: ["acme-review"],
      held: [],
    });
  });

  it("keeps acme-review when its file is still there but refused", async () => {
    const pack = fakePack();

    pack.files = [{ path: "skills/acme-review.md", text: ACME_REVIEW_TEXT }];
    await applyPack(pack.deps());
    pack.files = [{ path: "skills/acme-review.md", text: "no help here" }];

    await applyPack(pack.deps());

    expect({
      held: pack.catalogue.get("acme-review")?.content,
      listed: pack.sync?.skills,
      refused: pack.sync?.refused_files.map((file) => file.path),
    }).toEqual({
      held: ACME_REVIEW_TEXT,
      listed: ["acme-review"],
      refused: ["skills/acme-review.md"],
    });
  });

  it("leaves the catalogue alone when the pack cannot be reached", async () => {
    const pack = fakePack();

    pack.files = [{ path: "skills/acme-review.md", text: ACME_REVIEW_TEXT }];
    await applyPack(pack.deps());
    pack.unreachable = new Error("connect ETIMEDOUT github.example");
    pack.files = [];

    await applyPack(pack.deps());

    expect({
      held: [...pack.catalogue.keys()],
      removals: pack.skillRemovals,
      listed: pack.sync?.skills,
    }).toEqual({
      held: ["acme-review"],
      removals: [],
      listed: ["acme-review"],
    });
  });
});
