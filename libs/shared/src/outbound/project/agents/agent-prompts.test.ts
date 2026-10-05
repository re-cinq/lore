import { describe, expect, it } from "vitest";
import { shippedAgentPrompts, withAgentPrompts } from "./agent-prompts.js";

const PIPELINE = {
  line: { id: "code-review" },
  agent_definitions: {
    "code-review": { settings: { model: "gemini-3.1-pro-preview" } },
  },
};

describe("withAgentPrompts", () => {
  it("fills the code-review agent's prompt from the code-review body it is given", () => {
    const prompts = new Map([["code-review", "Review {pr_number}.\n"]]);

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
      withAgentPrompts(inline, new Map([["code-review", "body\n"]])),
    ).toThrow(
      new Error(
        "agent definition code-review carries an inline prompt; its prompt is libs/shared/src/agent-defaults/code-review.md",
      ),
    );
  });

  it("leaves a pipeline with no agent definitions as it is", () => {
    const stations = { line: { id: "merge" } };

    expect(withAgentPrompts(stations, new Map())).toEqual(stations);
  });
});

describe("shippedAgentPrompts", () => {
  it("reads the loop-tdd-round prompt from libs/shared/src/agent-defaults/loop-tdd-round.md", () => {
    expect(shippedAgentPrompts().get("loop-tdd-round")).toMatch(
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
