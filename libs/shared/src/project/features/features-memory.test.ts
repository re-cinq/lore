import { describe, it, expect } from "vitest";
import { InMemoryFeatures } from "./features-memory.js";
import type { GapResult } from "../../feature-planning/gap-result.js";

const tick = (start: number) => {
  let t = start;

  return () => new Date((t += 1000));
};

const T0 = Date.UTC(2026, 7, 4, 12, 0, 0);

describe("InMemoryFeatures.create", () => {
  it("inserts a draft with slug + path derived from the title and ui as default creator", async () => {
    const features = new InMemoryFeatures(tick(T0));
    const created = await features.create("a/b", {
      title: "Add SSO Login!",
      prompt: "we need sso",
    });

    expect(created).toMatchObject({
      repo: "a/b",
      title: "Add SSO Login!",
      slug: "add-sso-login",
      path: "specs/add-sso-login",
      original_prompt: "we need sso",
      status: "draft",
      current_iteration: 0,
      parent_feature_id: null,
      created_by: "ui",
    });
  });

  it("createSplitChild links the child to its parent", async () => {
    const features = new InMemoryFeatures(tick(T0));
    const parent = await features.create("a/b", { title: "Big", prompt: "p" });
    const child = await features.createSplitChild("a/b", parent.id, {
      title: "Small",
      prompt: "p2",
      createdBy: "split",
    });

    expect(child).toMatchObject({
      parent_feature_id: parent.id,
      created_by: "split",
    });
  });
});

describe("InMemoryFeatures reads", () => {
  it("get returns the feature with iterations oldest-first, and null for the wrong repo", async () => {
    const features = new InMemoryFeatures(tick(T0));
    const feature = await features.create("a/b", { title: "F", prompt: "p" });

    await features.appendIteration("a/b", feature.id, null);
    await features.appendIteration("a/b", feature.id, { q: "a" });
    const loaded = await features.get("a/b", feature.id);

    expect(loaded?.iterations.map((i) => i.iteration)).toEqual([1, 2]);
    expect(await features.get("other/repo", feature.id)).toBeNull();
  });

  it("list filters by repo and status, newest-updated first", async () => {
    const features = new InMemoryFeatures(tick(T0));
    const older = await features.create("a/b", { title: "One", prompt: "p" });
    const newer = await features.create("a/b", { title: "Two", prompt: "p" });

    await features.create("other/repo", { title: "Elsewhere", prompt: "p" });
    expect((await features.list("a/b")).map((f) => f.id)).toEqual([
      newer.id,
      older.id,
    ]);
    await features.transitionStatus("a/b", older.id, "spec-ready");
    expect((await features.list("a/b", "spec-ready")).map((f) => f.id)).toEqual(
      [older.id],
    );
  });
});

describe("InMemoryFeatures.appendIteration", () => {
  it("mints the next iteration, flips the feature to planning, and inserts a running round", async () => {
    const features = new InMemoryFeatures(tick(T0));
    const feature = await features.create("a/b", { title: "F", prompt: "p" });
    const iteration = await features.appendIteration("a/b", feature.id, {
      answer: 42,
    });

    expect(iteration).toMatchObject({
      feature_id: feature.id,
      iteration: 1,
      status: "running",
      user_answers: { answer: 42 },
      task_id: null,
      gap_result: null,
    });
    expect(await features.get("a/b", feature.id)).toMatchObject({
      status: "planning",
      current_iteration: 1,
    });
  });

  it("throws for a missing feature, like the Pg adapter's unguarded RETURNING deref", async () => {
    const features = new InMemoryFeatures(tick(T0));

    await expect(
      features.appendIteration("a/b", "missing", null),
    ).rejects.toThrow(new Error("appendIteration: feature not found"));
  });
});

describe("InMemoryFeatures iteration writes", () => {
  it("attachIterationTask and setIterationResult are repo-scoped: the wrong repo writes nothing", async () => {
    const features = new InMemoryFeatures(tick(T0));
    const feature = await features.create("a/b", { title: "F", prompt: "p" });

    await features.appendIteration("a/b", feature.id, null);
    const gap: GapResult = { gaps: [] } as unknown as GapResult;

    await features.attachIterationTask("other/repo", feature.id, 1, "task-1");
    await features.setIterationResult(
      "other/repo",
      feature.id,
      1,
      gap,
      "ready",
    );
    expect(
      (await features.get("a/b", feature.id))?.iterations[0],
    ).toMatchObject({ task_id: null, status: "running", gap_result: null });

    await features.attachIterationTask("a/b", feature.id, 1, "task-1");
    await features.setIterationResult("a/b", feature.id, 1, gap, "ready");
    expect(
      (await features.get("a/b", feature.id))?.iterations[0],
    ).toMatchObject({ task_id: "task-1", status: "ready", gap_result: gap });
  });
});

describe("InMemoryFeatures.transitionStatus", () => {
  it("moves the status and applies only the defined patch fields", async () => {
    const features = new InMemoryFeatures(tick(T0));
    const feature = await features.create("a/b", { title: "F", prompt: "p" });
    const updated = await features.transitionStatus(
      "a/b",
      feature.id,
      "pr-open",
      { spec_pr_url: "https://github.com/a/b/pull/1", spec_pr_number: 1 },
    );

    expect(updated).toMatchObject({
      status: "pr-open",
      spec_pr_url: "https://github.com/a/b/pull/1",
      spec_pr_number: 1,
      draft_spec_md: null,
      issue_number: null,
    });
  });
});

describe("InMemoryFeatures.delete", () => {
  it("removes the feature and cascades its iterations; false when absent", async () => {
    const features = new InMemoryFeatures(tick(T0));
    const feature = await features.create("a/b", { title: "F", prompt: "p" });

    await features.appendIteration("a/b", feature.id, null);
    expect(await features.delete("a/b", feature.id)).toBe(true);
    expect(features.rows).toHaveLength(0);
    expect(features.iterations).toHaveLength(0);
    expect(await features.delete("a/b", feature.id)).toBe(false);
  });
});

describe("InMemoryFeatures.transitionStatus no-match", () => {
  it("returns undefined for an unknown id, mirroring the Pg rows[0] on a no-match UPDATE", async () => {
    const features = new InMemoryFeatures();

    expect(
      await features.transitionStatus("a/b", "missing", "pr-open"),
    ).toBeUndefined();
  });
});
