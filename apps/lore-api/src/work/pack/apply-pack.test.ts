import { describe, expect, it } from "vitest";
import { applyPack } from "./apply-pack.js";
import {
  EXTENDED_REVIEWER,
  EXTENSION,
  fakePack,
  SHIPPED_REVIEWER,
  TRIAGE_AGENT_TEXT,
  TRIAGE_PIPELINE_TEXT,
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
        error: null,
        error_at: null,
      },
    });
  });

  it("puts nothing a second time when the pack has not changed", async () => {
    const pack = fakePack();

    pack.files = [
      EXTENSION,
      { path: "triage/pipeline.yaml", text: TRIAGE_PIPELINE_TEXT },
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
      { path: "triage/pipeline.yaml", text: TRIAGE_PIPELINE_TEXT },
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
      { path: "triage/pipeline.yaml", text: TRIAGE_PIPELINE_TEXT },
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
      { path: "triage/pipeline.yaml", text: TRIAGE_PIPELINE_TEXT },
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
      { path: "triage/pipeline.yaml", text: TRIAGE_PIPELINE_TEXT },
      { path: "triage/agents/triager.md", text: TRIAGE_AGENT_TEXT },
    ];
    await applyPack(pack.deps());
    pack.files = [
      { path: "triage/pipeline.yaml", text: "line: [" },
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
      refused: ["triage/pipeline.yaml"],
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
});
