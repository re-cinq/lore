import { describe, it, expect, afterEach } from "vitest";
import { runCommentTriageStation } from "./comment-triage.js";
import { Llm } from "@re-cinq/lore-shared/llm/llm.js";
import { FakeLlm } from "@re-cinq/lore-shared/llm/fake-llm.js";
import type { StationInput } from "../input.js";

afterEach(() => Llm.reset());

function input(params: Record<string, string>): StationInput {
  return {
    assembly_line_id: "al-1",
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
      input({ comment_body: "ok, fix it", in_reply_to_id: "5", pr_number: "42" }),
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
});
