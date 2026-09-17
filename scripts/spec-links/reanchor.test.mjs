import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidatePaths,
  mapLine,
  parseHunks,
  reanchorMarkdown,
  titleOf,
} from "./reanchor.mjs";

const TEST_FILE = [
  'describe("x", () => {',
  '  it("listSince caps the batch", () => {',
  "    expect(1).toBe(1);",
  "  });",
  "",
  '  it("a new test inserted above", () => {',
  "    expect(2).toBe(2);",
  "  });",
  "",
  '  it("snapshot of an empty log falls back to cursor 0", () => {',
  "    expect(3).toBe(3);",
  "  });",
  "});",
].join("\n");

function io(overrides = {}) {
  return {
    target: (candidates) => ({ path: candidates[0], content: TEST_FILE }),
    baseLinks: () => null,
    hunksFor: () => [],
    ...overrides,
  };
}

test("moves a title-form link to the line where its it() now starts", () => {
  const md =
    "- Statement. ([validated by snapshot of an empty log falls back to cursor 0](../../libs/x/y.test.ts#L6))";
  const { content, changes } = reanchorMarkdown(md, "specs/a/spec.md", io());

  assert.equal(
    content,
    "- Statement. ([validated by snapshot of an empty log falls back to cursor 0](../../libs/x/y.test.ts#L10))",
  );
  assert.deepEqual(changes, [
    {
      label: "validated by snapshot of an empty log falls back to cursor 0",
      path: "libs/x/y.test.ts",
      from: 6,
      to: 10,
    },
  ]);
});

test("leaves a title-form link alone when its anchor already lies inside that test's span", () => {
  const md = "([validated by listSince caps the batch](libs/x/y.test.ts#L3))";
  const { content, changes } = reanchorMarkdown(md, "specs/a/spec.md", io());

  assert.equal(content, md);
  assert.deepEqual(changes, []);
});

test("reports a title several tests carry and changes nothing", () => {
  const twice = `${TEST_FILE}\n  it("listSince caps the batch", () => {});\n`;
  const md = "([validated by listSince caps the batch](libs/x/y.test.ts#L40))";
  const { content, unmapped } = reanchorMarkdown(
    md,
    "specs/a/spec.md",
    io({ target: (c) => ({ path: c[0], content: twice }) }),
  );

  assert.equal(content, md);
  assert.equal(unmapped[0].reason, "several tests carry this title");
});

test("maps a basename:NN label through the diff hunks from the base copy and rewrites the label too", () => {
  const md =
    "([`y.test.ts:2`](libs/x/y.test.ts#L2), [`y.test.ts:7`](libs/x/y.test.ts#L7))";
  const hunks = parseHunks("@@ -5,0 +6,4 @@ inserted four lines after line 5");
  const base = [
    { label: "`y.test.ts:2`", line: 2 },
    { label: "`y.test.ts:7`", line: 7 },
  ];
  const { content } = reanchorMarkdown(
    md,
    "specs/a/spec.md",
    io({ baseLinks: () => base, hunksFor: () => hunks }),
  );

  assert.equal(
    content,
    "([`y.test.ts:2`](libs/x/y.test.ts#L2), [`y.test.ts:7`](libs/x/y.test.ts#L11))",
  );
});

test("maps a prose label through the hunks by finding the same label in the base copy, even when the branch added other links to that file", () => {
  const md =
    "([validated by recipe demands red first](libs/x/y.test.ts#L7), [validated by a link this branch added](libs/x/y.test.ts#L2))";
  const hunks = parseHunks("@@ -5,0 +6,4 @@");
  const base = [{ label: "validated by recipe demands red first", line: 7 }];
  const { content, unmapped } = reanchorMarkdown(
    md,
    "specs/a/spec.md",
    io({ baseLinks: () => base, hunksFor: () => hunks }),
  );

  assert.equal(
    content,
    "([validated by recipe demands red first](libs/x/y.test.ts#L11), [validated by a link this branch added](libs/x/y.test.ts#L2))",
  );
  assert.equal(unmapped[0].label, "validated by a link this branch added");
});

test("pairs basename labels by ordinal among their kind, so a prose link added above them does not shift the pairing", () => {
  const md =
    "([validated by some prose](libs/x/y.test.ts#L1), [`y.test.ts:7`](libs/x/y.test.ts#L7))";
  const hunks = parseHunks("@@ -5,0 +6,4 @@");
  const base = [{ label: "`y.test.ts:7`", line: 7 }];
  const { content } = reanchorMarkdown(
    md,
    "specs/a/spec.md",
    io({ baseLinks: () => base, hunksFor: () => hunks }),
  );

  assert.equal(
    content,
    "([validated by some prose](libs/x/y.test.ts#L1), [`y.test.ts:7`](libs/x/y.test.ts#L11))",
  );
});

test("ignores links to files that are not tests", () => {
  const md = "([implemented by `platform.ts:88`](libs/x/platform.ts#L88))";

  assert.equal(reanchorMarkdown(md, "specs/a/spec.md", io()).content, md);
});

test("mapLine shifts lines after an insertion and returns null for a rewritten line", () => {
  const hunks = parseHunks("@@ -3,2 +3,5 @@\n@@ -20,0 +24,1 @@");

  assert.equal(mapLine(2, hunks), 2);
  assert.equal(mapLine(3, hunks), null);
  assert.equal(mapLine(10, hunks), 13);
  assert.equal(mapLine(21, hunks), 25);
});

test("titleOf strips the validated-by prefix and backticks, and rejects the basename form", () => {
  assert.equal(titleOf("validated by `does  the\n thing`"), "does the thing");
  assert.equal(titleOf("`y.test.ts:12`"), null);
  assert.equal(titleOf(""), null);
});

test("candidatePaths tries the markdown-relative path first and the repo-root path second", () => {
  assert.deepEqual(
    candidatePaths("../../apps/floor/a.test.ts", "specs/loop/spec.md"),
    ["apps/floor/a.test.ts", "apps/floor/a.test.ts"],
  );
  assert.deepEqual(
    candidatePaths("apps/floor/a.test.ts", "specs/loop/spec.md"),
    ["apps/floor/a.test.ts"],
  );
});

test("leaves links to test files outside the branch's scope untouched, however stale", () => {
  const md =
    "([validated by snapshot of an empty log falls back to cursor 0](libs/x/y.test.ts#L6))";
  const { content, changes } = reanchorMarkdown(
    md,
    "specs/a/spec.md",
    io({ inScope: () => false }),
  );

  assert.equal(content, md);
  assert.deepEqual(changes, []);
});

test("rewrites the NN of a basename label that carries the validated-by prefix, not only a bare one", () => {
  const md = "([validated by `y.test.ts:7`](libs/x/y.test.ts#L7))";
  const hunks = parseHunks("@@ -5,0 +6,4 @@");
  const base = [{ label: "validated by `y.test.ts:7`", line: 7 }];
  const { content } = reanchorMarkdown(
    md,
    "specs/a/spec.md",
    io({ baseLinks: () => base, hunksFor: () => hunks }),
  );

  assert.equal(content, "([validated by `y.test.ts:7`](libs/x/y.test.ts#L11))");
});

test("pairs a repeated basename label with the same label's occurrence in the base copy, so relabelling another link by title does not hand each later link its neighbour's anchor", () => {
  const md =
    "([validated by listSince caps the batch](libs/x/y.test.ts#L2), [`y.test.ts:7`](libs/x/y.test.ts#L7), [`y.test.ts:3`](libs/x/y.test.ts#L3)) and again ([`y.test.ts:7`](libs/x/y.test.ts#L7))";
  const hunks = parseHunks("@@ -5,0 +6,4 @@");
  const base = [
    { label: "`y.test.ts:2`", line: 2 },
    { label: "`y.test.ts:7`", line: 7 },
    { label: "`y.test.ts:3`", line: 3 },
    { label: "`y.test.ts:7`", line: 7 },
  ];
  const { content } = reanchorMarkdown(
    md,
    "specs/a/spec.md",
    io({ baseLinks: () => base, hunksFor: () => hunks }),
  );

  assert.equal(
    content,
    "([validated by listSince caps the batch](libs/x/y.test.ts#L2), [`y.test.ts:7`](libs/x/y.test.ts#L11), [`y.test.ts:3`](libs/x/y.test.ts#L3)) and again ([`y.test.ts:7`](libs/x/y.test.ts#L11))",
  );
});

test("reports a basename label the base copy lacks as unmapped when the branch holds fewer such links than the base, instead of taking a neighbour's anchor by ordinal", () => {
  const md =
    "([validated by listSince caps the batch](libs/x/y.test.ts#L2), [`y.test.ts:99`](libs/x/y.test.ts#L7))";
  const hunks = parseHunks("@@ -5,0 +6,4 @@");
  const base = [
    { label: "`y.test.ts:2`", line: 2 },
    { label: "`y.test.ts:7`", line: 7 },
  ];
  const { content, unmapped } = reanchorMarkdown(
    md,
    "specs/a/spec.md",
    io({ baseLinks: () => base, hunksFor: () => hunks }),
  );

  assert.equal(content, md);
  assert.equal(unmapped[0].label, "`y.test.ts:99`");
});

test("keeps a basename label as the base copy spells it, so a second run over its own output moves nothing even when one link's new line is another link's old label", () => {
  const md =
    "([`y.test.ts:3`](libs/x/y.test.ts#L3), [`y.test.ts:7`](libs/x/y.test.ts#L7))";
  const hunks = parseHunks("@@ -2,0 +3,4 @@");
  const base = [
    { label: "`y.test.ts:3`", line: 3 },
    { label: "`y.test.ts:7`", line: 7 },
  ];
  const run = (markdown) =>
    reanchorMarkdown(
      markdown,
      "specs/a/spec.md",
      io({ baseLinks: () => base, hunksFor: () => hunks }),
    );
  const first = run(md);

  assert.equal(
    first.content,
    "([`y.test.ts:3`](libs/x/y.test.ts#L7), [`y.test.ts:7`](libs/x/y.test.ts#L11))",
  );
  assert.deepEqual(run(first.content).changes, []);
});
