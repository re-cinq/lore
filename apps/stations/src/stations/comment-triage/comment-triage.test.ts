import { describe, it, expect, afterEach } from "vitest";
import { runCommentTriageStation } from "./comment-triage.js";
import { Llm } from "@re-cinq/lore-shared/llm/llm.js";
import { FakeLlm } from "@re-cinq/lore-shared/llm/fake-llm.js";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";

afterEach(() => Llm.reset());

function input(params: Record<string, string>): StationInput {
  return {
    assembly_run_id: "al-1",
    node_id: "triage",
    node_type: "comment-triage",
    repo: "re-cinq/lore",
    branch: "feat/x",
    task_id: null,
    params,
  };
}

describe("runCommentTriageStation", () => {
  it("emits the classified action in LORE_NODE_RESULT extras", async () => {
    Llm.setInstance(
      new FakeLlm({ data: { action: "address", reason: "approved" } }),
    );

    const result = await runCommentTriageStation(
      input({
        comment_body: "ok, fix it",
        in_reply_to_id: "5",
        pr_number: "42",
      }),
    );

    expect(result).toMatchObject({
      outcome: "success",
      extras: { action: "address" },
    });
  });

  it("defaults to ignore when classification fails", async () => {
    Llm.setInstance(new FakeLlm({ data: { action: "nonsense", reason: "" } }));

    const result = await runCommentTriageStation(
      input({ comment_body: "thanks", pr_number: "42" }),
    );

    expect(result.extras?.action).toBe("ignore");
  });

  it("reports the classification call's usage on the node result for the cost sink", async () => {
    Llm.setInstance(
      new FakeLlm({
        data: { action: "answer", reason: "question" },
        usage: { inputTokens: 812, outputTokens: 41, costUsd: 0.0008 },
      }),
    );

    const result = await runCommentTriageStation(
      input({ comment_body: "why this?", pr_number: "42" }),
    );

    expect(result.usage).toMatchObject({
      inputTokens: 812,
      outputTokens: 41,
      costUsd: 0.0008,
      model: "fake",
    });
  });
});

describe("runCommentTriageStation when the model is unreachable", () => {
  it("fails the node naming the cause, rather than reporting an ignorable comment", async () => {
    Llm.setInstance({
      vendor: "throwing",
      complete: () => Promise.reject(new Error("no model credential")),
      completeWithTool: () => Promise.reject(new Error("no model credential")),
    });

    const result = await runCommentTriageStation(
      input({ comment_body: "please fix the typo", pr_number: "7" }),
    );

    expect(result).toMatchObject({
      outcome: "failed",
      failureDetail: expect.stringContaining("no model credential"),
    });
  });

  it("carries no action on a failure, so nothing downstream routes on a guess", async () => {
    Llm.setInstance({
      vendor: "throwing",
      complete: () => Promise.reject(new Error("down")),
      completeWithTool: () => Promise.reject(new Error("down")),
    });

    const result = await runCommentTriageStation(input({ comment_body: "hm" }));

    expect(result.extras?.action).toBeUndefined();
  });
});
