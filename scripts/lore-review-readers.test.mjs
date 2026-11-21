import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(
  new URL("./lore-review-readers.mjs", import.meta.url),
);
const snapshot = {
  files: [
    {
      path: "src/rate.ts",
      role: "code",
      before: "return 2",
      after: "return 3",
    },
    {
      path: "src/rate.test.ts",
      role: "test",
      before: null,
      after: "expect(3)",
    },
  ],
  discussion: [],
  specs: [],
};

// A stand-in for the claude CLI: it answers each of the three prompts by what the prompt asks for, and records what it was given.
function review(t, failing = "", input = snapshot) {
  const root = mkdtempSync(join(tmpdir(), "review-test-"));
  const repo = join(root, "repo");

  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, "claude"),
    `#!/usr/bin/env node
    const { readFileSync, readdirSync, appendFileSync } = require("node:fs");
    const args = process.argv.slice(2);
    const prompt = args[args.indexOf("-p") + 1];
    const step = prompt.includes("Tell the story") ? "story" : prompt.includes("docs.json") ? "docs" : prompt.includes("issue.json") ? "issue" : "implementation";
    appendFileSync(${JSON.stringify(join(root, "calls"))}, JSON.stringify({ step, model: args.includes("--model") ? args[args.indexOf("--model") + 1] : null, files: readdirSync(".").sort(), issueNames: readdirSync(".").includes("issue.json") ? ["specs/rate/spec.md", "docs/rate.md"].filter((name) => readFileSync("issue.json", "utf8").includes(name)) : null, workspace: prompt.includes("/workspace/"), repo: prompt.includes(${JSON.stringify(repo + "/src")}) || prompt.includes(${JSON.stringify(repo + ",")}) || prompt.includes(${JSON.stringify(repo + ".")}) }) + "\\n");
    if (step === process.env.FAILING) process.exit(2);
    const answers = {
      story: { status: "complete", story: [{ text: "The rate is 3.", tests: [{ path: "src/rate.test.ts", line: 1 }] }] },
      implementation: { status: "complete", summary: "The code returns 3.", gaps: [] },
      docs: { status: "complete", summary: "The rate statement holds.", gaps: [], closed: [], declined: [] },
      issue: { status: "complete", summary: "One requirement is untold.", gaps: [{ kind: "missing_test", subject: "a negative rate is refused", detail: "The issue asks for it.", location: { path: "src/rate.test.ts", line: 1 }, proposal: "expect(() => rate(-1)).toThrow();", evidence: [] }] },
    };
    console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: JSON.stringify(answers[step]) }));
  `,
    { mode: 0o700 },
  );
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src/rate.test.ts"), "expect(3)\n");
  const result = spawnSync(process.execPath, [runner], {
    cwd: repo,
    input: JSON.stringify(input),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: root,
      PATH: root + delimiter + process.env.PATH,
      FAILING: failing,
    },
  });
  const calls = spawnSync("cat", [join(root, "calls")], { encoding: "utf8" })
    .stdout.trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.ok(result.stdout, result.stderr);

  return { status: result.status, report: JSON.parse(result.stdout), calls };
}

test("a local review tells the story, runs both checks against it on the developer's own Claude Code model, and prints the comment and the verdict the hosted review would give", (t) => {
  const { status, report, calls } = review(t);

  assert.deepEqual(
    {
      status,
      outcome: report.status,
      verdict: report.review.verdict,
      onLine: report.review.findings.map(({ path, line, subject }) => [
        path,
        line,
        subject,
      ]),
      told: report.comment.includes("\n\nThe rate is 3.\n\n"),
      steps: calls.map(({ step, model, workspace }) => [
        step,
        model,
        workspace,
      ]),
    },
    {
      status: 0,
      outcome: "complete",
      verdict: "changes_requested",
      onLine: [
        ["src/rate.test.ts", 1, "Missing test: a negative rate is refused"],
      ],
      told: true,
      steps: [
        ["story", null, false],
        ["implementation", null, false],
        ["issue", null, false],
      ],
    },
  );
});

test("the story is told from the tests packet alone, each check is handed the story, and the issue check what the implementation check found", (t) => {
  const { calls } = review(t);

  assert.deepEqual(
    calls.map(({ files }) => files),
    [
      ["tests.json"],
      ["code.json", "story.txt", "tests.json"],
      [
        "code.json",
        "implementation-check.txt",
        "issue.json",
        "story.txt",
        "tests.json",
      ],
    ],
  );
});

test("a step that fails leaves the local review incomplete and names it", (t) => {
  const { status, report } = review(t, "implementation");

  assert.deepEqual(
    [status, report.status, report.incomplete, report.review],
    [1, "incomplete", ["Implementation check", "Issue check"], undefined],
  );
});

const rewrittenSpec = {
  path: "specs/rate/spec.md",
  before: "# Rate\n\n- The rate is 2.\n",
  after: "# Rate\n\n- The rate is 3. ([validated by](src/rate.test.ts#L1))\n",
};

test("a local review of a change that rewrites a spec statement runs the documents check after both checks, on docs.json alone, against the working tree", (t) => {
  const { status, report, calls } = review(t, "", {
    ...snapshot,
    documents: [rewrittenSpec],
  });

  assert.deepEqual(
    {
      status,
      outcome: report.status,
      steps: calls.map(({ step }) => step),
      docs: calls
        .filter(({ step }) => step === "docs")
        .map(({ files, repo }) => ({ files, repo })),
    },
    {
      status: 0,
      outcome: "complete",
      steps: ["story", "implementation", "issue", "docs"],
      docs: [{ files: ["docs.json"], repo: true }],
    },
  );
});

test("a local review of documents alone runs the documents check only and approves the statement that holds", (t) => {
  const { report, calls } = review(t, "", {
    files: [],
    discussion: [],
    specs: [],
    documents: [rewrittenSpec],
  });

  assert.deepEqual(
    [calls.map(({ step }) => step), report.status, report.review.verdict],
    [["docs"], "complete", "approved"],
  );
});

test("a local review of a change that moves only spec links runs no step and approves it", (t) => {
  const { report, calls } = review(t, "", {
    files: [],
    discussion: [],
    specs: [],
    documents: [
      {
        path: "specs/rate/spec.md",
        before: "- The rate is 3. ([validated by](src/rate.test.ts#L1))\n",
        after: "- The rate is 3. ([validated by](src/rate.test.ts#L2))\n",
      },
    ],
  });

  assert.deepEqual(
    [calls, report.status, report.review.verdict],
    [[], "complete", "approved"],
  );
});

test("a local review hands the issue check a changed document whole and leaves a changed spec to the documents check", (t) => {
  const { calls } = review(t, "", {
    ...snapshot,
    documents: [
      rewrittenSpec,
      { path: "docs/rate.md", before: "Rate 2.\n", after: "Rate 3.\n" },
    ],
  });

  assert.deepEqual(calls.find(({ step }) => step === "issue")?.issueNames, [
    "docs/rate.md",
  ]);
});
