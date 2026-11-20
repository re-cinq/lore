import { test } from "node:test";
import assert from "node:assert/strict";
import {
  discussionFor,
  productDocuments,
  productSpecs,
  specStatements,
} from "./lore-review-pr-context.mjs";

test("human replies to the Lore thread and linked issue decisions reach the intent reader", async () => {
  const human = {
    user: { type: "User", login: "maintainer" },
    html_url: "https://github.com/acme/widgets/issues/2",
    body: "Defer exports.",
  };
  const bot = {
    ...human,
    user: { type: "Bot", login: "lore[bot]" },
    body: "PRIOR REVIEW",
  };
  const api = {
    paginate: async (list, params) => list(params),
    rest: {
      issues: {
        listComments: ({ issue_number }) =>
          issue_number === 2 ? [human] : [bot],
        get: async () => ({ data: { ...human, title: "Exports" } }),
      },
      pulls: {
        listReviews: () => [bot],
        listReviewComments: () => [
          { ...human, in_reply_to_id: 17, path: "queue.ts", line: 7 },
        ],
      },
    },
  };
  const discussion = await discussionFor(
    api,
    { owner: "acme", repo: "widgets" },
    { ...human, number: 3, body: "Closes #2" },
  );

  assert.deepEqual(
    discussion.map((item) => item.source),
    ["pull_request", "issue", "issue_comment", "review_thread"],
  );
  assert.match(discussion.at(-1).text, /reply to #17/);
  assert.doesNotMatch(JSON.stringify(discussion), /PRIOR REVIEW/);
});

const SPEC = "specs/queue/spec.md";
const before = [
  "# Queue",
  "",
  "## Limits",
  "",
  "- A queue holds up to 25 items.",
  "- A full queue refuses a new item. ([validated by](../../queue.test.ts#L4))",
  "- An empty queue costs nothing.",
].join("\n");
const after = before.replace("25 items", "50 items");

test("a changed spec travels as the statement it loses and the one it gains, never whole", () => {
  assert.deepEqual(specStatements(SPEC, before, after, []), [
    {
      path: SPEC,
      heading: "Limits",
      version: "removed",
      text: "A queue holds up to 25 items.",
    },
    {
      path: SPEC,
      heading: "Limits",
      version: "proposed",
      text: "A queue holds up to 50 items.",
    },
  ]);
});

test("an unchanged statement travels when it names a file the pull request touches", () => {
  assert.deepEqual(specStatements(SPEC, before, before, ["queue.test.ts"]), [
    {
      path: SPEC,
      heading: "Limits",
      version: "existing",
      text: "A full queue refuses a new item. ([validated by](../../queue.test.ts#L4))",
    },
  ]);
});

test("a spec with no changed statement and none about a touched file sends nothing", () => {
  assert.deepEqual(specStatements(SPEC, before, before, ["other.ts"]), []);
});

test("the collector sends the statements of a changed spec at both commits", async () => {
  const git = async ([command, ...args]) =>
    command === "show"
      ? args[0].startsWith("base:")
        ? before
        : after
      : SPEC + "\0";

  assert.deepEqual(
    (await productSpecs(git, "base", "head", [], [])).map(
      ({ version, text }) => [version, text],
    ),
    [
      ["removed", "A queue holds up to 25 items."],
      ["proposed", "A queue holds up to 50 items."],
    ],
  );
});

test("changed prompt and UI Markdown reach product evidence separately from specifications", async () => {
  const prompt = "libs/shared/src/agent-defaults/welcome.md";
  const ui = "apps/web-ui/content/start.mdx";
  const git = async ([command, ...args]) => {
    if (command === "cat-file") {
      return {
        old: "Ask which project to open.",
        next: "Open the first project.",
        ui: "Open a project",
      }[args[1]];
    }
    assert.deepEqual(
      [command, ...args],
      ["diff", "--raw", "-z", "--no-abbrev", "--no-renames", "base", "head"],
    );

    return [
      ":100644 100644 old next M",
      prompt,
      ":100644 000000 ui 0 D",
      ui,
      ":100644 100644 excluded-old excluded-new M",
      "specs/welcome/spec.md",
      ":100644 100644 code-old code-new M",
      "apps/web-ui/start.tsx",
      "",
    ].join("\0");
  };

  assert.deepEqual(await productDocuments(git, "base", "head"), [
    {
      path: prompt,
      before: "Ask which project to open.",
      after: "Open the first project.",
    },
    { path: ui, before: "Open a project", after: null },
  ]);
});
