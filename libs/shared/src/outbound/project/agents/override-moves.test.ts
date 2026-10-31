import { describe, it, expect } from "vitest";
import type { AgentDefinitionBody } from "@re-cinq/floor-client";
import { FloorAgentDefs } from "./agent-defs-floor.js";
import { InMemoryAgentDefinitions } from "./agent-defs-floor.fixture.js";
import {
  moveOverridesToFloor,
  overrideMoves,
  type StoredAgentRow,
} from "./override-moves.js";

function row(fields: Partial<StoredAgentRow>): StoredAgentRow {
  return {
    name: "loop-tdd",
    repo: null,
    model: null,
    timeout_minutes: null,
    prompt: null,
    image: null,
    config: null,
    ...fields,
  };
}

const ORG = row({
  model: "claude-opus-4-7",
  timeout_minutes: 30,
  prompt: "Make the test pass.",
  image: "agent:1",
});

const LOOP_TDD: AgentDefinitionBody = {
  settings: {
    model: "claude-opus-4-7",
    prompt: "Make the test pass.",
    image: "agent:1",
    timeoutMinutes: 30,
  },
};

describe("overrideMoves", () => {
  it("moves only otto's model gemini-3.1-pro, leaving out the prompt it copied unchanged from the org row", () => {
    const otto = row({
      repo: "re-cinq/otto",
      model: "gemini-3.1-pro",
      timeout_minutes: 30,
      prompt: "Make the test pass.",
      image: "agent:1",
    });

    expect(overrideMoves([ORG, otto])).toEqual([
      {
        repo: "re-cinq/otto",
        name: "loop-tdd",
        patch: { model: "gemini-3.1-pro" },
      },
    ]);
  });

  it("moves otto's pod_resources config, which differs from the org row's none", () => {
    const config = { pod_resources: { limits: { memory: "4Gi" } } };

    expect(overrideMoves([ORG, row({ repo: "re-cinq/otto", config })])).toEqual(
      [{ repo: "re-cinq/otto", name: "loop-tdd", patch: { config } }],
    );
  });

  it("moves nothing for a repo row that only repeats the org row", () => {
    expect(overrideMoves([ORG, row({ ...ORG, repo: "re-cinq/otto" })])).toEqual(
      [],
    );
  });

  it("moves every field a repo row sets for an agent with no org row", () => {
    expect(
      overrideMoves([
        row({
          name: "loop-dod",
          repo: "re-cinq/otto",
          model: "gemini-3.1-pro",
        }),
      ]),
    ).toEqual([
      {
        repo: "re-cinq/otto",
        name: "loop-dod",
        patch: { model: "gemini-3.1-pro" },
      },
    ]);
  });
});

describe("moveOverridesToFloor", () => {
  it("puts otto's model into loop-tdd's variant and reports it moved", async () => {
    const definitions = new InMemoryAgentDefinitions();

    await definitions.put("loop-tdd", LOOP_TDD);
    const report = await moveOverridesToFloor(
      [
        {
          repo: "re-cinq/otto",
          name: "loop-tdd",
          patch: { model: "gemini-3.1-pro" },
        },
      ],
      new FloorAgentDefs(definitions),
    );
    const stored = await definitions.get("loop-tdd");

    expect({ report, variants: stored?.body.variants }).toEqual({
      report: { moved: ["loop-tdd@re-cinq/otto: model"], skipped: [] },
      variants: { "github.com/re-cinq/otto": { model: "gemini-3.1-pro" } },
    });
  });

  it("skips feature-request for otto, an agent the floor does not hold", async () => {
    const report = await moveOverridesToFloor(
      [
        {
          repo: "re-cinq/otto",
          name: "feature-request",
          patch: { model: "gemini-3.1-pro" },
        },
      ],
      new FloorAgentDefs(new InMemoryAgentDefinitions()),
    );

    expect(report).toEqual({
      moved: [],
      skipped: ["feature-request@re-cinq/otto"],
    });
  });

  it("puts no new version when otto's variant already holds the model", async () => {
    const definitions = new InMemoryAgentDefinitions();

    await definitions.put("loop-tdd", {
      ...LOOP_TDD,
      variants: { "github.com/re-cinq/otto": { model: "gemini-3.1-pro" } },
    });
    await moveOverridesToFloor(
      [
        {
          repo: "re-cinq/otto",
          name: "loop-tdd",
          patch: { model: "gemini-3.1-pro" },
        },
      ],
      new FloorAgentDefs(definitions),
    );

    expect((await definitions.versions("loop-tdd")).length).toBe(1);
  });
});
