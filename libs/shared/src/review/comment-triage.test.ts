import { describe, it, expect, afterEach } from "vitest";
import { classifyComment } from "./comment-triage.js";
import { Llm } from "../llm/llm.js";
import { FakeLlm } from "../llm/fake-llm.js";

afterEach(() => Llm.reset());

describe("classifyComment", () => {
  it("returns the action the model chose", async () => {
    Llm.setInstance(
      new FakeLlm({ data: { action: "address", reason: "approved the fix" } }),
    );

    expect(
      await classifyComment({
        body: "ok, fix it",
        isReply: true,
        prNumber: 7,
        originalComment: "issue: null deref here",
      }),
    ).toEqual({ action: "address", reason: "approved the fix" });
  });

  it("defaults to ignore when the model returns an unknown action", async () => {
    Llm.setInstance(new FakeLlm({ data: { action: "explode", reason: "?" } }));

    expect(
      await classifyComment({ body: "thanks!", isReply: false, prNumber: 7 }),
    ).toMatchObject({ action: "ignore" });
  });

  it("passes the replied-to comment into the prompt for a reply", async () => {
    const fake = new FakeLlm({
      data: { action: "answer", reason: "question" },
    });

    Llm.setInstance(fake);

    await classifyComment({
      body: "why this?",
      isReply: true,
      prNumber: 12,
      originalComment: "issue: guard the null",
    });

    expect(fake.calls[0]?.prompt).toContain("issue: guard the null");
  });
});
