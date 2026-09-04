import { describe, it, expect } from "vitest";
import type { PipelineTask } from "@re-cinq/lore-shared";
import {
  hasMergeStepFields,
  toMergeStepTask,
  toFlipSpecStatusTask,
} from "./run.js";

const row = (over: Partial<PipelineTask> = {}): PipelineTask => ({
  id: "t-1",
  description: "do the thing",
  task_type: "implementation",
  status: "pr-created",
  target_repo: "acme/widgets",
  pr_number: 7,
  review_iteration: 0,
  created_by: "agent",
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
  priority: "normal",
  ...over,
});

describe("hasMergeStepFields", () => {
  it("returns false for a null row", () => {
    expect(hasMergeStepFields(null)).toBe(false);
  });

  it("returns false when the row carries no pr_number", () => {
    expect(hasMergeStepFields(row({ pr_number: undefined }))).toBe(false);
  });

  it("returns true when the row carries a pr_number", () => {
    expect(hasMergeStepFields(row({ pr_number: 7 }))).toBe(true);
  });
});

describe("toMergeStepTask", () => {
  it("narrows a full row to the merge step's task shape", () => {
    expect(
      toMergeStepTask(
        row({ issue_number: 3 }) as PipelineTask & { pr_number: number },
      ),
    ).toEqual({
      id: "t-1",
      target_repo: "acme/widgets",
      pr_number: 7,
      issue_number: 3,
      task_type: "implementation",
      description: "do the thing",
    });
  });

  it("defaults a missing issue_number to null", () => {
    expect(
      toMergeStepTask(row() as PipelineTask & { pr_number: number })
        .issue_number,
    ).toBeNull();
  });
});

describe("toFlipSpecStatusTask", () => {
  it("passes through a row's optional fields when they are set", () => {
    const now = "2026-09-04T00:00:00.000Z";

    expect(
      toFlipSpecStatusTask(
        row({
          target_branch: "spec/x",
          pr_url: "https://example.test/pr/7",
          task_group_id: "g1",
          context_bundle: { feature_id: "f1" },
          created_at: "2026-08-01T00:00:00.000Z",
        }),
        now,
      ),
    ).toMatchObject({
      target_branch: "spec/x",
      pr_url: "https://example.test/pr/7",
      task_group_id: "g1",
      context_bundle: { feature_id: "f1" },
      created_at: "2026-08-01T00:00:00.000Z",
    });
  });

  it("normalises undefined optional fields to null and defaults created_at to now", () => {
    const now = "2026-09-04T00:00:00.000Z";

    expect(
      toFlipSpecStatusTask(
        row({
          target_branch: undefined,
          pr_url: undefined,
          task_group_id: undefined,
          context_bundle: undefined,
          created_at: undefined as unknown as string,
        }),
        now,
      ),
    ).toMatchObject({
      target_branch: null,
      pr_url: null,
      task_group_id: null,
      context_bundle: null,
      created_at: now,
    });
  });

  it("falls back to an all-null shape when there is no row", () => {
    const now = "2026-09-04T00:00:00.000Z";

    expect(toFlipSpecStatusTask(null, now)).toMatchObject({
      target_branch: null,
      pr_url: null,
      task_group_id: null,
      context_bundle: null,
      created_at: now,
    });
  });
});
