import { describe, it, expect } from "vitest";
import { resolveHref, blobUrl } from "./github-links";

describe("resolveHref", () => {
  it("rewrites a repo-relative path to a GitHub blob URL marked external", () => {
    expect(
      resolveHref("agent/src/x.test.ts#L7", "re-cinq/lore", "main"),
    ).toEqual({
      href: "https://github.com/re-cinq/lore/blob/main/agent/src/x.test.ts#L7",
      external: true,
    });
  });

  it("strips a leading ./ before building the GitHub URL", () => {
    expect(resolveHref("./adrs/ADR-1.md", "re-cinq/lore", "main").href).toEqual(
      "https://github.com/re-cinq/lore/blob/main/adrs/ADR-1.md",
    );
  });

  it("uses the given branch in the GitHub URL", () => {
    expect(resolveHref("a.ts", "o/r", "develop").href).toEqual(
      "https://github.com/o/r/blob/develop/a.ts",
    );
  });

  it("leaves an absolute https URL unchanged and marks it external", () => {
    expect(
      resolveHref("https://example.com/x", "re-cinq/lore", "main"),
    ).toEqual({
      href: "https://example.com/x",
      external: true,
    });
  });

  it("leaves an in-page anchor unchanged and not external", () => {
    expect(resolveHref("#section", "re-cinq/lore", "main")).toEqual({
      href: "#section",
      external: false,
    });
  });

  it("leaves a relative path unchanged when repo is not owner/name", () => {
    expect(resolveHref("src/x.test.ts#L1", "unknown", "main")).toEqual({
      href: "src/x.test.ts#L1",
      external: false,
    });
  });

  it("returns empty external false for an empty href", () => {
    expect(resolveHref("", "re-cinq/lore", "main")).toEqual({
      href: "",
      external: false,
    });
  });
});

describe("blobUrl", () => {
  it("builds a plain blob URL with no anchor when no lines given", () => {
    expect(blobUrl("re-cinq/lore", "main", "web-ui/src/x.ts")).toEqual(
      "https://github.com/re-cinq/lore/blob/main/web-ui/src/x.ts",
    );
  });

  it("appends a #L{start}-L{end} range when both lines given", () => {
    expect(
      blobUrl("re-cinq/lore", "main", "a/b.ts", { start: 10, end: 42 }),
    ).toEqual("https://github.com/re-cinq/lore/blob/main/a/b.ts#L10-L42");
  });

  it("appends a single #L{start} when only start given", () => {
    expect(blobUrl("re-cinq/lore", "main", "a/b.ts", { start: 10 })).toEqual(
      "https://github.com/re-cinq/lore/blob/main/a/b.ts#L10",
    );
  });

  it("strips a leading ./ from the path", () => {
    expect(blobUrl("o/r", "main", "./a.ts")).toEqual(
      "https://github.com/o/r/blob/main/a.ts",
    );
  });

  it("returns empty string when repo is not owner/name", () => {
    expect(blobUrl("unknown", "main", "a.ts", { start: 1, end: 2 })).toEqual(
      "",
    );
  });
});
