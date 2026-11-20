import { describe, expect, it } from "vitest";
import {
  previousRelease,
  releaseFile,
  releaseValues,
} from "./release-collected.js";

describe("previousRelease", () => {
  it("returns the v1.10.0 entry for tags v1.9.3, v1.10.0 and nightly", () => {
    expect(
      previousRelease([
        { name: "v1.9.3", sha: "aaa" },
        { name: "v1.10.0", sha: "bbb" },
        { name: "nightly", sha: "ccc" },
      ]),
    ).toEqual({ name: "v1.10.0", sha: "bbb" });
  });

  it("returns null for the tag nightly alone", () => {
    expect(previousRelease([{ name: "nightly", sha: "ccc" }])).toBeNull();
  });
});

describe("releaseValues", () => {
  it("carries sha, tag and both range ends for a release after v1.2.0", () => {
    expect(
      releaseValues({
        sha: "bbb",
        previousTag: "v1.2.0",
        rangeFrom: "2026-11-02T08:00:00Z",
        rangeTo: "2026-11-20T09:30:00Z",
      }),
    ).toEqual({
      release_sha: "bbb",
      previous_tag: "v1.2.0",
      range_from: "2026-11-02T08:00:00.000Z",
      range_to: "2026-11-20T09:30:00.000Z",
    });
  });

  it("leaves out previous_tag and range_from for a repo with no tag", () => {
    expect(
      releaseValues({
        sha: "bbb",
        previousTag: null,
        rangeFrom: null,
        rangeTo: "2026-11-20T09:30:00Z",
      }),
    ).toEqual({ release_sha: "bbb", range_to: "2026-11-20T09:30:00.000Z" });
  });
});

describe("releaseFile", () => {
  it("serializes repo, previous tag, sha, range and changes, with null for the absent ones", () => {
    expect(
      JSON.parse(
        releaseFile({
          repo: "re-cinq/lore",
          sha: "bbb",
          previousTag: null,
          rangeFrom: null,
          rangeTo: "2026-11-20T09:30:00Z",
          changes: [],
        }),
      ),
    ).toEqual({
      repo: "re-cinq/lore",
      previous_tag: null,
      sha: "bbb",
      range_from: null,
      range_to: "2026-11-20T09:30:00.000Z",
      changes: [],
    });
  });
});
