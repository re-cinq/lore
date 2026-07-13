import { describe, it, expect } from "vitest";
import { resolveUrl, splitBlocks } from "./readme-markdown";

const base = "https://raw.githubusercontent.com/re-cinq/lore/main/";

describe("resolveUrl", () => {
  it("returns an https url unchanged", () => {
    expect(resolveUrl("https://example.com/a.png", base)).toBe(
      "https://example.com/a.png",
    );
  });

  it("returns a mailto link unchanged", () => {
    expect(resolveUrl("mailto:dev@re-cinq.com", base)).toBe(
      "mailto:dev@re-cinq.com",
    );
  });

  it("returns a data uri unchanged", () => {
    expect(resolveUrl("data:image/png;base64,AAAA", base)).toBe(
      "data:image/png;base64,AAAA",
    );
  });

  it("returns an in-page anchor unchanged", () => {
    expect(resolveUrl("#section", base)).toBe("#section");
  });

  it("returns the url unchanged when the base is empty", () => {
    expect(resolveUrl("docs/img.png", "")).toBe("docs/img.png");
  });

  it("resolves a relative path against the base", () => {
    expect(resolveUrl("docs/img.png", base)).toBe(
      "https://raw.githubusercontent.com/re-cinq/lore/main/docs/img.png",
    );
  });

  it("returns the original url when the base is unparseable", () => {
    expect(resolveUrl("docs/img.png", "not a url")).toBe("docs/img.png");
  });
});

describe("splitBlocks", () => {
  it("splits on blank lines and trims each block", () => {
    expect(splitBlocks("# Title\n\nFirst para\n\nSecond para")).toEqual([
      "# Title",
      "First para",
      "Second para",
    ]);
  });

  it("drops empty blocks from runs of blank lines", () => {
    expect(splitBlocks("a\n\n\n  \n\nb")).toEqual(["a", "b"]);
  });

  it("returns a single-element array for one block", () => {
    expect(splitBlocks("just one block")).toEqual(["just one block"]);
  });

  it("returns an empty array for all-whitespace input", () => {
    expect(splitBlocks("   \n\n  \n")).toEqual([]);
  });
});
