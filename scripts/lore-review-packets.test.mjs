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
    context: true,
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

test("an unchanged file the change is about, such as its own test or a fixture, travels whole", () => {
  const own = lines(40, 3, "import { limit } from './limit';");
  const { test_evidence: tests } = packets(
    { path: "src/limit.test.ts", role: "test", before: own, after: own },
    { path: "src/fixtures/rate.json", role: "test", before: "{}", after: "{}" },
  );

  assert.deepEqual(tests.files, [
    { path: "src/limit.test.ts", unchanged: own },
    { path: "src/fixtures/rate.json", unchanged: "{}" },
  ]);
});

test("a context file that names nothing the pull request changes is left out", () => {
  const unrelated = lines(40, 30, "import { enforce } from './enforce';");
  const { code_evidence: code } = packets({
    path: "src/other.ts",
    role: "code",
    before: unrelated,
    after: unrelated,
    context: true,
  });

  assert.deepEqual(
    code.files.map(({ path }) => path),
    ["src/limit.ts"],
  );
});

test("two uses closer than their margins travel as one block", () => {
  const consumer = lines(60, 20, "limit();").replace("// line 28", "limit();");
  const { code_evidence: code } = packets({
    path: "src/queue.ts",
    role: "code",
    before: consumer,
    after: consumer,
    context: true,
  });

  assert.deepEqual(
    code.files[1].uses.map((block) => [block[0], block.at(-1)]),
    [["10| // line 10", "38| // line 38"]],
  );
});

test("a file found by a changed configuration key travels as the lines that read the key", () => {
  const reader = lines(40, 30, "const size = process.env.QUEUE_SIZE;");
  const { code_evidence: code } = storyPackets({
    files: [
      limit,
      {
        path: "src/env.ts",
        role: "code",
        before: reader,
        after: reader,
        context: true,
      },
    ],
    terms: ["limit", "QUEUE_SIZE"],
    discussion: [],
    specs: [],
  });

  assert.equal(
    code.files[1].uses[0][10],
    "30| const size = process.env.QUEUE_SIZE;",
  );
});

test("both checks are handed what people answered on the pull request, so a declined gap can be told from an open one", () => {
  const reply = {
    source: "review_thread",
    url: "https://github.com/acme/pilot/pull/42#discussion_r7",
    text: "src/limit.ts 1 reply to #3\n\nIntended, we will not change this.",
  };
  const asked = {
    source: "issue",
    url: "https://github.com/acme/pilot/issues/2",
    text: "Raise the limit.",
  };
  const { code_evidence: code, issue_evidence: issue } = storyPackets({
    files: [limit],
    discussion: [asked, reply],
    specs: [],
  });

  assert.deepEqual(
    [code.replies, issue.discussion.length],
    [[{ source: reply.source, url: reply.url, text: reply.text }], 2],
  );
});
