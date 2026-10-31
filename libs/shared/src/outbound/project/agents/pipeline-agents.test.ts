import { describe, expect, it } from "vitest";
import {
  shippedAgentPrompts,
  shippedFloorAgents,
  withAgentDefinitions,
} from "./pipeline-agents.js";

const PIPELINE = {
  line: { id: "code-review" },
  stations: {
    review: { agent_definition: "code-review" },
    "post-review": {},
    "second-review": { agent_definition: "code-review" },
  },
};

const CODE_REVIEW = {
  model: "gemini-4-argon",
  timeout_minutes: 25,
  prompt: "Review {pr_number}.\n",
};

describe("withAgentDefinitions", () => {
  it("adds one code-review definition built from its file for the two stations that name it", () => {
    const agents = new Map([["code-review", CODE_REVIEW]]);

    expect(withAgentDefinitions(PIPELINE, agents)).toEqual({
      ...PIPELINE,
      agent_definitions: { "code-review": { settings: CODE_REVIEW } },
    });
  });

  it("throws naming code-review.md when no file exists for the code-review agent", () => {
    expect(() => withAgentDefinitions(PIPELINE, new Map())).toThrow(
      new Error(
        "agent definition code-review has no prompt: libs/shared/src/agent-defaults/code-review.md is missing or has no body",
      ),
    );
  });

  it("throws when the pipeline file still carries an agent_definitions block", () => {
    const declared = { ...PIPELINE, agent_definitions: {} };

    expect(() =>
      withAgentDefinitions(declared, new Map([["code-review", CODE_REVIEW]])),
    ).toThrow(
      new Error(
        "a pipeline file carries an agent_definitions block; an agent's settings live in libs/shared/src/agent-defaults/<definition>.md",
      ),
    );
  });

  it("leaves a merge pipeline whose stations name no agent as it is", () => {
    const stations = { line: { id: "merge" }, stations: { merge: {} } };

    expect(withAgentDefinitions(stations, new Map())).toEqual(stations);
  });
});

describe("shippedFloorAgents", () => {
  it("reads code-review's model, timeout and skills source from libs/shared/src/agent-defaults/code-review.md", () => {
    expect(shippedFloorAgents().get("code-review")).toMatchObject({
      model: "gemini-4-argon",
      image: "${LORE_AGENT_IMAGE}",
      timeout_minutes: 25,
      config: { max_turns: 150, skills_source: "${LORE_SKILLS_URL}" },
    });
  });
});

describe("shippedAgentPrompts", () => {
  it("reads the loop-tdd-round prompt from libs/shared/src/agent-defaults/loop-tdd-round.md", () => {
    expect(shippedAgentPrompts().get("loop-tdd-round")).toMatch(
      /^You are editing files in a git repository/,
    );
  });
});
