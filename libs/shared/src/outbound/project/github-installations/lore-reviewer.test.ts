import { describe, expect, it } from "vitest";
import { loreReviewerGitHub } from "./lore-reviewer.js";

describe("loreReviewerGitHub", () => {
  it("builds a configured client from the three LORE_REVIEWER_APP_* values", () => {
    const github = loreReviewerGitHub({
      LORE_REVIEWER_APP_ID: "42",
      LORE_REVIEWER_APP_PRIVATE_KEY: "key",
      LORE_REVIEWER_APP_INSTALLATION_ID: "7",
    });

    expect(github?.isConfigured()).toBe(true);
  });

  it("is null when the installation id is missing, so the loop knows it has no reviewer", () => {
    expect(
      loreReviewerGitHub({
        LORE_REVIEWER_APP_ID: "42",
        LORE_REVIEWER_APP_PRIVATE_KEY: "key",
      }),
    ).toBeNull();
  });
});
