import { describe, expect, it } from "vitest";
import { parseDodMarkdown } from "./dod-markdown.js";

const TEMPLATE = `# Definition of Done

> Users can archive a note and it disappears from the list.

**Strategy: \`direct\`** — the list already renders from a filtered
selector; one predicate and one flag.

## Done when these pass

- [ ] **archives a note and hides it from the list** — the archived note is
  absent from the next render
  \`src/notes/archive.test.ts\`
- [x] **keeps archived notes readable by id** — a direct read still resolves
  \`src/notes/read.test.ts\`

## Facets

- [x] red: the archive test fails on the missing flag
- [ ] green: the selector filters archived notes

## Out of scope

- bulk archive
- restoring an archived note
`;

describe("parseDodMarkdown", () => {
  it("parses the template into its claim, strategy, tests, facets and out-of-scope items", () => {
    expect(parseDodMarkdown(TEMPLATE)).toEqual({
      ticketClaim: "Users can archive a note and it disappears from the list.",
      strategy: "direct",
      why: "the list already renders from a filtered selector; one predicate and one flag.",
      acceptanceTests: [
        {
          path: "src/notes/archive.test.ts",
          name: "archives a note and hides it from the list",
          behaviour: "the archived note is absent from the next render",
          done: false,
        },
        {
          path: "src/notes/read.test.ts",
          name: "keeps archived notes readable by id",
          behaviour: "a direct read still resolves",
          done: true,
        },
      ],
      facets: [
        { text: "red: the archive test fails on the missing flag", done: true },
        { text: "green: the selector filters archived notes", done: false },
      ],
      outOfScope: ["bulk archive", "restoring an archived note"],
    });
  });

  it("reads the earlier path::name — behaviour line and tolerates a missing strategy", () => {
    const text = `# Definition of Done

> Claim.

## Acceptance tests

- tests/a.test.ts::adds two numbers — sums them
- ./tests/b.test.ts::subtracts - the difference
`;

    expect(parseDodMarkdown(text)).toMatchObject({
      strategy: "",
      why: "",
      acceptanceTests: [
        {
          path: "tests/a.test.ts",
          name: "adds two numbers",
          behaviour: "sums them",
          done: false,
        },
        {
          path: "./tests/b.test.ts",
          name: "subtracts",
          behaviour: "the difference",
          done: false,
        },
      ],
      facets: [],
      outOfScope: [],
    });
  });

  it("returns null when the text has no Definition of Done title", () => {
    expect(parseDodMarkdown("# Notes\n\n- [ ] **x** — y\n")).toBeNull();
  });
});
