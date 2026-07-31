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
    ).toMatchObject({ action: "address", reason: "approved the fix" });
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

  it("returns the classification call's usage for the station cost report", async () => {
    Llm.setInstance(
      new FakeLlm({
        data: { action: "answer", reason: "question" },
        usage: { inputTokens: 812, outputTokens: 41, costUsd: 0.0008 },
      }),
    );

    const decision = await classifyComment({
      body: "why this?",
      isReply: false,
      prNumber: 7,
    });

    expect(decision.usage).toMatchObject({
      inputTokens: 812,
      outputTokens: 41,
      costUsd: 0.0008,
      model: "fake",
    });
  });

  it("returns no usage when the model call throws", async () => {
    Llm.setInstance({
      vendor: "throwing",
      complete: () => Promise.reject(new Error("down")),
      completeWithTool: () => Promise.reject(new Error("down")),
    });

    expect(
      await classifyComment({ body: "hm", isReply: false, prNumber: 7 }),
    ).toEqual({ action: "ignore", reason: "triage failed" });
  });
});
