import { describe, expect, it } from "vitest";
import {
  definitionDrift,
  shippedAgentPrompts,
  withAgentPrompts,
} from "./agent-prompts.js";

const PIPELINE = {
  line: { id: "code-review" },
  agent_definitions: {
    "code-review": { settings: { model: "gemini-3.1-pro-preview" } },
  },
};

describe("withAgentPrompts", () => {
  it("fills the code-review agent's prompt from the code-review body it is given", () => {
    const prompts = new Map([
      ["code-review", { prompt: "Review {pr_number}.\n" }],
    ]);

    expect(withAgentPrompts(PIPELINE, prompts)).toEqual({
      line: { id: "code-review" },
      agent_definitions: {
        "code-review": {
          settings: {
            model: "gemini-3.1-pro-preview",
            prompt: "Review {pr_number}.\n",
          },
        },
      },
    });
  });

  it("throws naming code-review.md when no body exists for the code-review agent", () => {
    expect(() => withAgentPrompts(PIPELINE, new Map())).toThrow(
      new Error(
        "agent definition code-review has no prompt: libs/shared/src/agent-defaults/code-review.md is missing or has no body",
      ),
    );
  });

  it("throws naming code-review when the pipeline file still carries an inline prompt", () => {
    const inline = {
      agent_definitions: {
        "code-review": { settings: { prompt: "inline" } },
      },
    };

    expect(() =>
      withAgentPrompts(
        inline,
        new Map([["code-review", { prompt: "body\n" }]]),
      ),
    ).toThrow(
      new Error(
        "agent definition code-review carries an inline prompt; its prompt is libs/shared/src/agent-defaults/code-review.md",
      ),
    );
  });

  it("returns the stored model claude-sonnet-4-6 and timeout 40 over the pipeline's gemini-3.1-pro-preview", () => {
    const stored = new Map([
      [
        "code-review",
        {
          prompt: "Review {pr_number}.\n",
          model: "claude-sonnet-4-6",
          timeout_minutes: 40,
        },
      ],
    ]);

    expect(withAgentPrompts(PIPELINE, stored)).toMatchObject({
      agent_definitions: {
        "code-review": {
          settings: {
            model: "claude-sonnet-4-6",
            timeout_minutes: 40,
            prompt: "Review {pr_number}.\n",
          },
        },
      },
    });
  });

  it("keeps the pipeline's gemini-3.1-pro-preview when the stored model is null", () => {
    const stored = new Map([
      ["code-review", { prompt: "Review.\n", model: null }],
    ]);

    expect(withAgentPrompts(PIPELINE, stored)).toMatchObject({
      agent_definitions: {
        "code-review": { settings: { model: "gemini-3.1-pro-preview" } },
      },
    });
  });

  it("keeps the pipeline's mcp_servers and skills when the stored config carries only test_policy", () => {
    const pipeline = {
      agent_definitions: {
        "code-review": {
          settings: {
            config: { mcp_servers: [{ name: "lore" }], skills: ["review"] },
          },
        },
      },
    };
    const stored = new Map([
      ["code-review", { prompt: "Review.\n", config: { test_policy: "none" } }],
    ]);

    expect(withAgentPrompts(pipeline, stored)).toMatchObject({
      agent_definitions: {
        "code-review": {
          settings: {
            config: { mcp_servers: [{ name: "lore" }], skills: ["review"] },
          },
        },
      },
    });
  });

  it("puts the stored pod_resources memory 4Gi over the pipeline's 2Gi", () => {
    const pipeline = {
      agent_definitions: {
        "code-review": {
          settings: {
            config: {
              skills: ["review"],
              pod_resources: { limits: { memory: "2Gi" } },
            },
          },
        },
      },
    };
    const stored = new Map([
      [
        "code-review",
        {
          prompt: "Review.\n",
          config: { pod_resources: { limits: { memory: "4Gi" } } },
        },
      ],
    ]);

    expect(withAgentPrompts(pipeline, stored)).toMatchObject({
      agent_definitions: {
        "code-review": {
          settings: {
            config: {
              skills: ["review"],
              pod_resources: { limits: { memory: "4Gi" } },
            },
          },
        },
      },
    });
  });

  it("leaves a pipeline with no agent definitions as it is", () => {
    const stations = { line: { id: "merge" } };

    expect(withAgentPrompts(stations, new Map())).toEqual(stations);
  });
});

describe("shippedAgentPrompts", () => {
  it("reads the loop-tdd-round prompt from libs/shared/src/agent-defaults/loop-tdd-round.md", () => {
    expect(shippedAgentPrompts().get("loop-tdd-round")?.prompt).toMatch(
      /^You are editing files in a git repository/,
    );
  });
});

describe("withAgentPrompts on an empty agent_definitions key", () => {
  it("leaves a pipeline whose agent_definitions key is empty (null) as it is", () => {
    const pipeline = { line: { id: "merge" }, agent_definitions: null };

    expect(withAgentPrompts(pipeline, new Map())).toEqual(pipeline);
  });
});

describe("definitionDrift", () => {
  const stored = new Map([
    ["code-review", { prompt: "Review.\n", model: "claude-sonnet-4-6" }],
    ["loop-dod", { prompt: "Define done.\n", model: null }],
  ]);

  it("returns code-review's prompt and model when the floor holds an older prompt on gemini-4-argon", () => {
    expect(
      definitionDrift(stored, [
        {
          id: "code-review",
          body: { settings: { prompt: "Old.\n", model: "gemini-4-argon" } },
        },
        {
          id: "loop-dod",
          body: {
            settings: { prompt: "Define done.\n", model: "gemini-4-argon" },
          },
        },
      ]),
    ).toEqual([{ name: "code-review", fields: ["prompt", "model"] }]);
  });

  it("returns nothing when the floor holds every stored prompt, a null model counting as the pipeline's", () => {
    expect(
      definitionDrift(stored, [
        {
          id: "code-review",
          body: {
            settings: { prompt: "Review.\n", model: "claude-sonnet-4-6" },
          },
        },
        {
          id: "loop-dod",
          body: {
            settings: { prompt: "Define done.\n", model: "gemini-4-argon" },
          },
        },
      ]),
    ).toEqual([]);
  });

  it("returns loop-dod's prompt when the floor holds no loop-dod at all", () => {
    expect(
      definitionDrift(
        new Map([["loop-dod", { prompt: "Define done.\n" }]]),
        [],
      ),
    ).toEqual([{ name: "loop-dod", fields: ["prompt"] }]);
  });
});
