import { describe, expect, it } from "vitest";
import { releaseAction } from "./release-body.js";

const SUMMARY = "Adds the release line.";
const existing = (body: string) => ({
  id: 7,
  tag: "v1.3.0",
  name: "v1.3.0",
  body,
  draft: false,
  url: "https://github.com/re-cinq/lore/releases/tag/v1.3.0",
});

describe("the body of a GitHub release", () => {
  it("creates the release with the summary as its body when there is none", () => {
    expect(releaseAction(null, SUMMARY)).toEqual({
      kind: "create",
      body: SUMMARY,
    });
  });

  it("keeps a release whose body already contains the summary", () => {
    expect(
      releaseAction(existing(`Intro.\n\n${SUMMARY}\n\nMore.`), SUMMARY),
    ).toEqual({ kind: "keep", url: existing("").url });
  });

  it("puts the summary first and the generated notes after it when the body lacks the summary", () => {
    expect(
      releaseAction(existing("## What's changed\n* a PR"), SUMMARY),
    ).toEqual({
      kind: "complete",
      id: 7,
      body: `${SUMMARY}\n\n## What's changed\n* a PR`,
    });
  });

  it("completes an empty body with the summary alone", () => {
    expect(releaseAction(existing(""), SUMMARY)).toEqual({
      kind: "complete",
      id: 7,
      body: SUMMARY,
    });
  });
});
