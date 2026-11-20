import { test } from "node:test";
import assert from "node:assert/strict";
import {
  discussionFor,
  productDocuments,
  productSpecs,
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

test("the base promise and the proposed replacement travel as distinct evidence", async () => {
  const path = "specs/queue/spec.md";
  const git = async ([command, ...args]) =>
    command === "show"
      ? args[0].startsWith("base:")
        ? "Up to 25 items"
        : "Up to 50 items"
      : path + "\0";
  const specs = await productSpecs(git, "base", "head", [], []);

  assert.deepEqual(specs, [
    { path, version: "existing", text: "Up to 25 items" },
    { path, version: "proposed", text: "Up to 50 items" },
  ]);
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
