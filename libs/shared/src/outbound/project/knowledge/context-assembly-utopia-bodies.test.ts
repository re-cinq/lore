import { describe, it, expect } from "vitest";
import { withBodies } from "./context-assembly-utopia-bodies.js";

const TEST_FILE = "libs/shared/src/domain/pr-body.test.ts";
const SOURCE = "libs/shared/src/domain/pr-body.ts";
const FILES: Record<string, string> = {
  [TEST_FILE]: [
    'import { prFooter } from "./pr-body.js";',
    "",
    'it("prints Lore-Task", () => {',
    '  expect(prFooter("t1")).toBe("Lore-Task: t1");',
    "});",
    "",
    'it("prints Refs", () => {',
    "});",
  ].join("\n"),
  [SOURCE]: Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n"),
};
const files = async (path: string) => FILES[path] ?? null;

describe("withBodies", () => {
  it("appends the test's lines 3-5 of pr-body.test.ts and the covered lines 7-7 and 9-10 of pr-body.ts under the item, each span led by its file and lines", async () => {
    expect(
      await withBodies(
        "prints Lore-Task",
        [
          { path: TEST_FILE, start: 3, end: 5 },
          { path: SOURCE, start: 7, end: 7 },
          { path: SOURCE, start: 9, end: 10 },
        ],
        files,
      ),
    ).toEqual(
      [
        "prints Lore-Task",
        `  --- ${TEST_FILE}:3-5`,
        '  it("prints Lore-Task", () => {',
        '    expect(prFooter("t1")).toBe("Lore-Task: t1");',
        "  });",
        `  --- ${SOURCE}:7-7`,
        "  line 7",
        `  --- ${SOURCE}:9-10`,
        "  line 9",
        "  line 10",
      ].join("\n"),
    );
  });

  it("cuts a span with no known end at 40 lines and a span past the file's end at the file's end", async () => {
    const open = await withBodies(
      "x",
      [{ path: SOURCE, start: 5, end: null }],
      files,
    );
    const past = await withBodies(
      "x",
      [{ path: SOURCE, start: 58, end: 70 }],
      files,
    );

    expect(open.split("\n")).toHaveLength(42);
    expect(open).toContain(`  --- ${SOURCE}:5-44`);
    expect(past.split("\n").slice(1)).toEqual([
      `  --- ${SOURCE}:58-60`,
      "  line 58",
      "  line 59",
      "  line 60",
    ]);
  });

  it("keeps the first three spans of five and leaves the item as it is when the file is not in the repository", async () => {
    const many = await withBodies(
      "x",
      [1, 2, 3, 4, 5].map((start) => ({ path: SOURCE, start, end: start })),
      files,
    );
    const gone = await withBodies(
      "x",
      [{ path: "gone.ts", start: 1, end: 2 }],
      files,
    );

    expect(many.match(/ {2}--- /g)).toHaveLength(3);
    expect(gone).toBe("x");
  });
});
