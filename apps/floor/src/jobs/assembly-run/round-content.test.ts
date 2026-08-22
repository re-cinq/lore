import { describe, it, expect } from "vitest";
import { resolveRoundContent } from "./round-content.js";

const resumed = {
  source: "http://floor/api/agent-conversations",
  id: "round-3",
  pin: "round-4",
  headersSecret: "agent-events-auth",
};

describe("resolveRoundContent", () => {
  it("sends only the new feedback when the run resumed a conversation", () => {
    expect(
      resolveRoundContent(
        {
          description: "<Title>…</Title>",
          args: { round_feedback: "<RoundFeedback/>" },
        },
        resumed,
      ),
    ).toBe("<RoundFeedback/>");
  });

  it("sends the full composition when the run starts a fresh conversation", () => {
    // An empty id is exactly "nothing to resume" — the agent holds no draft, so a
    // feedback-only turn would ask it to refine something it has never seen.
    expect(
      resolveRoundContent(
        {
          description: "<Title>…</Title>",
          args: { round_feedback: "<RoundFeedback/>" },
        },
        { ...resumed, id: "" },
      ),
    ).toBe("<Title>…</Title>");
  });

  it("sends the full composition when the node continues nothing at all", () => {
    expect(
      resolveRoundContent(
        {
          description: "<Title>…</Title>",
          args: { round_feedback: "<RoundFeedback/>" },
        },
        undefined,
      ),
    ).toBe("<Title>…</Title>");
  });

  it("sends the full composition when the line carries no feedback turn", () => {
    expect(
      resolveRoundContent(
        { description: "<Title>…</Title>", args: {} },
        resumed,
      ),
    ).toBe("<Title>…</Title>");
  });

  it("ignores a blank feedback turn rather than dispatching an empty prompt", () => {
    expect(
      resolveRoundContent(
        { description: "<Title>…</Title>", args: { round_feedback: "  " } },
        resumed,
      ),
    ).toBe("<Title>…</Title>");
  });
});
