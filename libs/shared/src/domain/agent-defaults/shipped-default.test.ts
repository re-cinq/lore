import { describe, it, expect } from "vitest";
import { mergeShippedDefault, type ShippedFields } from "./shipped-default.js";

const review: ShippedFields = {
  model: "claude-sonnet-4-6",
  timeout_minutes: 10,
  prompt: "Review the pull request.\n",
  execution_mode: "claude-code",
  review_required: false,
  config: { repo_workdir: false, skills: ["pr-review"] },
};

describe("mergeShippedDefault", () => {
  it("moves an untouched model from claude-sonnet-4-6 to the new default claude-opus-5", () => {
    const next = { ...review, model: "claude-opus-5" };

    expect(mergeShippedDefault(review, review, next)).toEqual({
      model: "claude-opus-5",
    });
  });

  it("keeps a model edited to gemini-3-flash-preview when the default moves to claude-opus-5", () => {
    const row = { ...review, model: "gemini-3-flash-preview" };
    const next = { ...review, model: "claude-opus-5" };

    expect(mergeShippedDefault(row, review, next)).toEqual({});
  });

  it("fills a NULL prompt on first contact and leaves a diverging timeout of 45 alone", () => {
    const row = { ...review, prompt: null, timeout_minutes: 45 };

    expect(mergeShippedDefault(row, null, review)).toEqual({
      prompt: "Review the pull request.\n",
    });
  });

  it("refills a prompt a full-replace save nulled after the default was seeded", () => {
    const row = { ...review, prompt: null };

    expect(mergeShippedDefault(row, review, review)).toEqual({
      prompt: "Review the pull request.\n",
    });
  });

  it("adopts new skills over a row whose only edit is 12Gi pod_resources, keeping the resources", () => {
    const podResources = { limits: { memory: "12Gi" } };
    const row = {
      ...review,
      config: { ...review.config, pod_resources: podResources },
    };
    const next = {
      ...review,
      config: { repo_workdir: false, skills: ["pr-review", "lore-context"] },
    };

    expect(mergeShippedDefault(row, review, next)).toEqual({
      config: {
        repo_workdir: false,
        skills: ["pr-review", "lore-context"],
        pod_resources: podResources,
      },
    });
  });

  it("adopts test_policy none onto code-review's config on first contact, since no write path edits config beyond pod_resources", () => {
    const row = { ...review, config: { repo_workdir: false } };
    const next = {
      ...review,
      config: { repo_workdir: false, test_policy: "none" },
    };

    expect(mergeShippedDefault(row, null, next)).toEqual({
      config: { repo_workdir: false, test_policy: "none" },
    });
  });

  it("changes nothing when the review row already equals the shipped default", () => {
    expect(mergeShippedDefault(review, review, review)).toEqual({});
  });
});
