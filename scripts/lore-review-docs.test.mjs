import { test } from "node:test";
import assert from "node:assert/strict";
import { docsEvidence, onlyLinksChanged } from "./lore-review-docs.mjs";

const SPEC = "specs/queue/spec.md";
const TEST = "libs/queue/queue.test.ts";
const spec = (...statements) =>
  ["# Queue", "", "## Limits", "", ...statements].join("\n");
const suite = [
  'import { expect, it } from "vitest";',
  "",
  'it("refuses item 26 of a full queue", () => {',
  "  expect(queue(25).add(26)).toBe(false);",
  "});",
].join("\n");
const reading = (files) => async (path) => files[path] ?? null;

test("a spec whose links alone moved is a change of links only", () => {
  const before = spec(
    "- A full queue refuses a new item. ([validated by @aaaaaaaa](../../libs/queue/queue.test.ts#L3))",
  );
  const after = spec(
    "- A full queue refuses a new item. ([validated by @bbbbbbbb](../../libs/queue/queue.test.ts#L9))",
  );

  assert.deepEqual(
    [
      onlyLinksChanged([{ path: SPEC, before, after }]),
      onlyLinksChanged([
        { path: SPEC, before, after: after + "\n- A queue holds 25 items." },
      ]),
      onlyLinksChanged([{ path: SPEC, before, after: null }]),
    ],
    [true, false, false],
  );
});

test("a statement the pull request rewrites is handed with its line, its heading and the linked test's lines, and one whose links alone moved is not", async () => {
  const kept =
    "- An empty queue costs nothing. ([validated by @aaaaaaaa](../../libs/queue/queue.test.ts#L3))";
  const before = spec("- A full queue refuses item 26.", kept);
  const after = spec(
    "- A full queue of 25 refuses item 26. ([validated by @deadbeef](../../libs/queue/queue.test.ts#L3))",
    kept.replace("#L3", "#L4"),
  );

  assert.deepEqual(
    await docsEvidence(
      [{ path: SPEC, before, after }],
      reading({ [TEST]: suite }),
    ),
    {
      mode: "docs",
      statements: [
        {
          path: SPEC,
          line: 5,
          heading: "Limits",
          text: "A full queue of 25 refuses item 26.",
          tests: [
            {
              path: TEST,
              line: 3,
              lines: [
                '3| it("refuses item 26 of a full queue", () => {',
                "4|   expect(queue(25).add(26)).toBe(false);",
                "5| });",
              ],
            },
          ],
        },
      ],
      removed: [
        {
          path: SPEC,
          heading: "Limits",
          text: "A full queue refuses item 26.",
        },
      ],
    },
  );
});

test("a linked test is found on the line its hash names, wherever the link's line number points", async () => {
  const moved = ["// moved down", "", suite].join("\n");
  const { statements } = await docsEvidence(
    [
      {
        path: SPEC,
        before: null,
        after: spec(
          "- A full queue refuses item 26. ([validated by @af0c2a5d](../../libs/queue/queue.test.ts#L3))",
        ),
      },
    ],
    reading({ [TEST]: moved }),
  );

  assert.deepEqual(
    statements[0].tests.map(({ line, lines }) => [line, lines[0]]),
    [[5, '5| it("refuses item 26 of a full queue", () => {']],
  );
});

test("a link to a test file the revision does not hold says so instead of showing lines", async () => {
  const { statements } = await docsEvidence(
    [
      {
        path: SPEC,
        before: null,
        after: spec(
          "- A full queue refuses item 26. ([validated by](../../libs/queue/queue.test.ts#L3))",
        ),
      },
    ],
    reading({}),
  );

  assert.deepEqual(statements[0].tests, [{ path: TEST, missing: true }]);
});

test("a changed sentence of a guide is handed with no tests, to be checked against the code", async () => {
  const { statements } = await docsEvidence(
    [
      {
        path: "docs/queue.md",
        before: "# Queue\n\nThe queue lives in `libs/queue`.",
        after: "# Queue\n\nThe queue lives in `libs/line`.",
      },
    ],
    reading({}),
  );

  assert.deepEqual(statements, [
    {
      path: "docs/queue.md",
      line: 3,
      heading: "Queue",
      text: "The queue lives in `libs/line`.",
      tests: [],
    },
  ]);
});
