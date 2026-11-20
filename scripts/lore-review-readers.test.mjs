import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
function review(t, failing = "") {
  const root = mkdtempSync(join(tmpdir(), "review-test-"));

  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, "claude"),
    `#!/usr/bin/env node
    const { readFileSync, readdirSync, appendFileSync } = require("node:fs");
    const args = process.argv.slice(2);
    const prompt = args[args.indexOf("-p") + 1];
    const step = prompt.includes("Tell the story") ? "story" : prompt.includes("issue.json") ? "issue" : "implementation";
    appendFileSync(${JSON.stringify(join(root, "calls"))}, JSON.stringify({ step, model: args[args.indexOf("--model") + 1], files: readdirSync(".").sort(), workspace: prompt.includes("/workspace/") }) + "\\n");
    if (step === process.env.FAILING) process.exit(2);
    const answers = {
      story: { status: "complete", story: [{ id: 1, behaviour: "The rate is 3.", tests: [{ path: "src/rate.test.ts", line: 1 }] }] },
      implementation: { status: "complete", summary: "The code returns 3.", gaps: [] },
      issue: { status: "complete", summary: "One requirement is untold.", gaps: [{ kind: "missing_test", subject: "a negative rate is refused", detail: "The issue asks for it.", location: { path: "src/rate.test.ts", line: 1 }, proposal: "expect(() => rate(-1)).toThrow();", evidence: [] }] },
    };
    console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: JSON.stringify(answers[step]) }));
  `,
    { mode: 0o700 },
  );
  const result = spawnSync(process.execPath, [runner], {
    input: JSON.stringify(snapshot),
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
    .map((line) => JSON.parse(line));

  assert.ok(result.stdout, result.stderr);

  return { status: result.status, report: JSON.parse(result.stdout), calls };
}

test("a local review tells the story, runs both checks against it and prints the comment and the verdict the hosted review would give", (t) => {
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
      told: report.comment.includes("1. The rate is 3."),
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
        ["story", "claude-sonnet-5-5", false],
        ["implementation", "claude-sonnet-5-5", false],
        ["issue", "claude-sonnet-5-5", false],
      ],
    },
  );
});

test("the story is told from the tests packet alone, and each check is handed the story", (t) => {
  const { calls } = review(t);

  assert.deepEqual(
    calls.map(({ files }) => files),
    [
      ["tests.json"],
      ["code.json", "story.txt", "tests.json"],
      ["code.json", "issue.json", "story.txt", "tests.json"],
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
