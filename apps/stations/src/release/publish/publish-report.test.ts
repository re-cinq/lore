import { describe, expect, it } from "vitest";
import {
  mirrorOf,
  failureReport,
  mirrorStatusReport,
  publishReport,
  type PublishedRelease,
} from "./publish-report.js";

const RELEASE: PublishedRelease = {
  repo: "re-cinq/lore-security",
  mirror: "re-cinq/lore",
  sha: "bbb222",
  version: "v1.3.0",
};

describe("the release-publish decisions", () => {
  it("returns success with published_to re-cinq/lore for a pushed outcome", () => {
    expect(
      publishReport({ kind: "pushed", sha: "bbb222", tag: "v1.3.0" }, RELEASE),
    ).toEqual({
      outcome: "success",
      produced: { published_to: "re-cinq/lore" },
    });
  });

  it("returns success with published_to re-cinq/lore for an already-up-to-date outcome", () => {
    expect(
      publishReport(
        { kind: "already-up-to-date", sha: "bbb222", tag: "v1.3.0" },
        RELEASE,
      ),
    ).toEqual({
      outcome: "success",
      produced: { published_to: "re-cinq/lore" },
    });
  });

  it("returns failed naming re-cinq/lore and ddd444 for a target-diverged outcome", () => {
    expect(
      publishReport({ kind: "target-diverged", targetHead: "ddd444" }, RELEASE),
    ).toEqual({
      outcome: "failed",
      error:
        "re-cinq/lore main is at ddd444, which is not an ancestor of bbb222 from re-cinq/lore-security; the mirror was left as it was",
    });
  });

  it("returns failed naming v1.3.0 and ccc333 for a tag-at-other-sha outcome", () => {
    expect(
      publishReport({ kind: "tag-at-other-sha", tagSha: "ccc333" }, RELEASE),
    ).toEqual({
      outcome: "failed",
      error:
        "tag v1.3.0 already sits at ccc333 on re-cinq/lore, not at bbb222 from re-cinq/lore-security; the mirror was left as it was",
    });
  });

  it("returns the mirror re-cinq/lore for settings with public_mirror, and null for none, null or a non-string", () => {
    expect([
      mirrorOf({ public_mirror: "re-cinq/lore" }),
      mirrorOf({}),
      mirrorOf(null),
      mirrorOf({ public_mirror: null }),
    ]).toEqual(["re-cinq/lore", null, null, null]);
  });

  it("returns null for LORE_MIRROR true", () => {
    expect(mirrorStatusReport("re-cinq/lore", "true")).toBe(null);
  });

  it("returns failed asking to set LORE_MIRROR and check the installation when the variable read answered null", () => {
    expect(mirrorStatusReport("re-cinq/lore", null)).toEqual({
      outcome: "failed",
      error:
        "re-cinq/lore has no Actions variable LORE_MIRROR: set it to true on that repository, and check the GitHub App is installed on it with Contents, Workflows and Variables access",
    });
  });

  it("returns failed naming the value false when LORE_MIRROR is false", () => {
    expect(mirrorStatusReport("re-cinq/lore", "false")).toEqual({
      outcome: "failed",
      error:
        "the workflows of re-cinq/lore are not switched off: its Actions variable LORE_MIRROR is false, not true",
    });
  });

  it("returns failed naming the missing installation on re-cinq/lore for status 404 and 403", () => {
    const reasons = [404, 403].map((status) =>
      failureReport(
        Object.assign(new Error("Not Found"), { status }),
        "re-cinq/lore",
      ),
    );

    expect(reasons).toEqual(
      [404, 403].map(() => ({
        outcome: "failed",
        error:
          "the GitHub App cannot read re-cinq/lore: install it on that repository with Contents, Workflows and Variables access",
      })),
    );
  });

  it("returns failed with the git message for an error without a status", () => {
    expect(failureReport(new Error("git push failed"), "re-cinq/lore")).toEqual(
      {
        outcome: "failed",
        error: "git push failed",
      },
    );
  });

  it("returns failed naming pull request 7 and a merge commit for a target-diverged outcome with that sync pull request", () => {
    expect(
      publishReport(
        { kind: "target-diverged", targetHead: "ddd444" },
        RELEASE,
        "https://github.com/re-cinq/lore-security/pull/7",
      ),
    ).toEqual({
      outcome: "failed",
      error:
        "the public main holds commits this repository lacks; merge https://github.com/re-cinq/lore-security/pull/7 with a merge commit, then release again",
    });
  });
});
