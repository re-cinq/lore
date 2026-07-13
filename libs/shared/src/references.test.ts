import { describe, it, expect } from "vitest";
import { parseReferences, linkifyMarkdown } from "./references.js";

const ctx = {
  repo: "re-cinq/lore",
  branch: "main",
  uiUrl: "https://lore.example",
};
const uuid = "fb964a3c-2c4c-4de6-b76c-cebe715b51a9";

describe("linkifyMarkdown", () => {
  it("links a file path to the GitHub blob url on the given branch", () => {
    expect(
      linkifyMarkdown("see specs/6-dark-factory/research.md now", ctx),
    ).toBe(
      "see [specs/6-dark-factory/research.md](https://github.com/re-cinq/lore/blob/main/specs/6-dark-factory/research.md) now",
    );
  });

  it("defaults to the main branch when none is given", () => {
    expect(linkifyMarkdown("edit src/a.ts", { repo: "re-cinq/lore" })).toBe(
      "edit [src/a.ts](https://github.com/re-cinq/lore/blob/main/src/a.ts)",
    );
  });

  it("links an issue reference to the issues url", () => {
    expect(linkifyMarkdown("fixes #424.", ctx)).toBe(
      "fixes [#424](https://github.com/re-cinq/lore/issues/424).",
    );
  });

  it("links a task uuid to the web-ui pipeline page when uiUrl is set", () => {
    expect(linkifyMarkdown(`task ${uuid} done`, ctx)).toBe(
      `task [${uuid}](https://lore.example/assembly-lines/${uuid}) done`,
    );
  });

  it("leaves a uuid untouched when no uiUrl is configured", () => {
    expect(linkifyMarkdown(`task ${uuid} done`, { repo: "re-cinq/lore" })).toBe(
      `task ${uuid} done`,
    );
  });

  it("does not linkify inside inline code", () => {
    expect(linkifyMarkdown("run `agent/src/foo.ts` here", ctx)).toBe(
      "run `agent/src/foo.ts` here",
    );
  });

  it("does not touch an existing markdown link", () => {
    expect(linkifyMarkdown("[the spec](https://x/spec.md)", ctx)).toBe(
      "[the spec](https://x/spec.md)",
    );
  });

  it("does not linkify a path inside a bare url", () => {
    expect(
      linkifyMarkdown("https://github.com/re-cinq/lore/blob/main/a.ts", ctx),
    ).toBe("https://github.com/re-cinq/lore/blob/main/a.ts");
  });

  it("links multiple references in one string", () => {
    expect(linkifyMarkdown("edit src/a.ts for #5", ctx)).toBe(
      "edit [src/a.ts](https://github.com/re-cinq/lore/blob/main/src/a.ts) for [#5](https://github.com/re-cinq/lore/issues/5)",
    );
  });

  it("strips a leading ./ from the linked path", () => {
    expect(linkifyMarkdown("./pkg/b.go", ctx)).toBe(
      "[./pkg/b.go](https://github.com/re-cinq/lore/blob/main/pkg/b.go)",
    );
  });

  it("leaves plain prose with no references unchanged", () => {
    expect(linkifyMarkdown("Reconcile the research doc with code.", ctx)).toBe(
      "Reconcile the research doc with code.",
    );
  });

  it("does not treat a version number as a file path", () => {
    expect(linkifyMarkdown("bump to v1.2.3 today", ctx)).toBe(
      "bump to v1.2.3 today",
    );
  });
});

describe("parseReferences", () => {
  it("returns text and link segments in order", () => {
    expect(parseReferences("edit src/a.ts", ctx)).toEqual([
      { text: "edit " },
      {
        text: "src/a.ts",
        href: "https://github.com/re-cinq/lore/blob/main/src/a.ts",
      },
    ]);
  });

  it("returns a single text segment for plain prose", () => {
    expect(parseReferences("nothing here", ctx)).toEqual([
      { text: "nothing here" },
    ]);
  });
});
