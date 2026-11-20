import assert from "node:assert/strict";
import { test } from "node:test";
import { storyPackets } from "./lore-review-packets.mjs";

const lines = (count, at, text) =>
  Array.from({ length: count }, (_unused, index) =>
    index + 1 === at ? text : `// line ${index + 1}`,
  ).join("\n");
const limit = {
  path: "src/limit.ts",
  role: "code",
  before: "export const limit = 1;",
  after: "export const limit = 2;",
  diff: "-1\n+2",
};
const packets = (...files) =>
  storyPackets({ files: [limit, ...files], discussion: [], specs: [] });

test("an unchanged file that only uses the changed code travels as the lines around each use, with their real numbers", () => {
  const consumer = lines(40, 30, "import { limit } from './limit';");
  const { code_evidence: code } = packets({
    path: "src/queue.ts",
    role: "code",
    before: consumer,
    after: consumer,
  });
  const [, queue] = code.files;

  assert.deepEqual(
    {
      path: queue.path,
      whole: queue.unchanged,
      blocks: queue.uses.length,
      first: queue.uses[0][0],
      use: queue.uses[0][10],
      last: queue.uses[0].at(-1),
    },
    {
      path: "src/queue.ts",
      whole: undefined,
      blocks: 1,
      first: "20| // line 20",
      use: "30| import { limit } from './limit';",
      last: "40| // line 40",
    },
  );
});

test("the unchanged test of a changed file travels whole, since every assertion in it tells the story", () => {
  const own = lines(40, 3, "import { limit } from './limit';");
  const { test_evidence: tests } = packets({
    path: "src/limit.test.ts",
    role: "test",
    before: own,
    after: own,
  });

  assert.deepEqual(tests.files, [
    { path: "src/limit.test.ts", unchanged: own },
  ]);
});

test("an unchanged file that never names the changed code travels whole, as a fixture does", () => {
  const { test_evidence: tests } = packets({
    path: "src/fixtures/rate.json",
    role: "test",
    before: "{}",
    after: "{}",
  });

  assert.deepEqual(tests.files, [
    { path: "src/fixtures/rate.json", unchanged: "{}" },
  ]);
});

test("two uses closer than their margins travel as one block", () => {
  const consumer = lines(60, 20, "limit();").replace("// line 28", "limit();");
  const { code_evidence: code } = packets({
    path: "src/queue.ts",
    role: "code",
    before: consumer,
    after: consumer,
  });

  assert.deepEqual(
    code.files[1].uses.map((block) => [block[0], block.at(-1)]),
    [["10| // line 10", "38| // line 38"]],
  );
});
