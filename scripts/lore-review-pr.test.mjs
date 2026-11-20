import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

async function pullRequest(t, before, after) {
  const root = await mkdtemp(join(tmpdir(), "lore-pr-test-"));

  t.after(() => rm(root, { force: true, recursive: true }));
  const repository = join(root, "origin");

  await mkdir(repository);
  const git = (...args) =>
    execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
  const commit = async (files, message) => {
    await Promise.all(
      Object.entries(files).map(async ([path, body]) => {
        await mkdir(dirname(join(repository, path)), { recursive: true });
        await writeFile(join(repository, path), body);
      }),
    );
    git("add", ".");
    git("commit", "-qm", message);

    return git("rev-parse", "HEAD");
  };

  git("init", "-q");
  git("config", "user.email", "test@example.org");
  git("config", "user.name", "Collector test");
  const base = await commit(before, "base");
  const head = await commit(after, "head");
  // Serve commit objects from the fixture while exercising a real shallow fetch.
  const shim = join(root, "git");

  await writeFile(
    shim,
    `#!/usr/bin/env node
const {spawnSync}=require("node:child_process");
const args=process.argv.slice(2).map(arg=>arg==="https://github.com/acme/pilot.git"?${JSON.stringify("file://" + repository)}:arg);
process.exit(spawnSync(${JSON.stringify(execFileSync("which", ["git"], { encoding: "utf8" }).trim())},args,{stdio:"inherit"}).status);
`,
    { mode: 0o700 },
  );
  const mock = join(root, "github.mjs");

  await writeFile(
    mock,
    `
globalThis.fetch=async (url) => {
  const path=new URL(url).pathname;
  let body=[];
  if(path==="/repos/acme/pilot/pulls/42") body={number:42,title:"Adjust limit",state:"open",head:{sha:${JSON.stringify(head)}},base:{sha:${JSON.stringify(base)}},html_url:"https://github.com/acme/pilot/pull/42"};
  else if(path.includes("/compare/")) body={merge_base_commit:{sha:${JSON.stringify(base)}}};
  else if(!/\\/(reviews|comments)$/.test(path)) throw new Error("unexpected GitHub path "+path);
  return new Response(JSON.stringify(body),{headers:{"content-type":"application/json"}});
};`,
  );
  const run = promisify(execFile);
  const args = [
    fileURLToPath(new URL("./lore-review-pr.mjs", import.meta.url)),
    "--repo",
    "acme/pilot",
    "--pr",
    "42",
    "--head",
    head,
  ];
  const options = {
    env: {
      PATH: root + ":" + process.env.PATH,
      HOME: root,
      GITHUB_TOKEN: "fixture-token",
      NODE_OPTIONS: "--import=" + mock,
    },
  };
  const collect = async (...extra) =>
    JSON.parse(
      (await run(process.execPath, [...args, ...extra], options)).stdout,
    );

  return { collect };
}

test("collects the tests, the code and the issue of a pull request at its pinned head", async (t) => {
  const { collect } = await pullRequest(
    t,
    {
      "limit.ts": "export const limit = 1;",
      "limit.test.ts": "expect(limit).toBe(1);",
    },
    { "limit.ts": "export const limit = 2;" },
  );
  const evidence = await collect();
  const [changed] = evidence.code_evidence.files;

  assert.deepEqual(
    {
      packets: Object.keys(evidence),
      tests: evidence.test_evidence.files,
      code: {
        path: changed.path,
        before: changed.before,
        after: changed.after,
      },
      diff: changed.diff.split("\n").filter((line) => /^[-+]e/.test(line)),
      issue: [evidence.issue_evidence.mode, evidence.issue_evidence.specs],
      asked: evidence.issue_evidence.discussion[0].text,
    },
    {
      packets: ["test_evidence", "code_evidence", "issue_evidence"],
      tests: [{ path: "limit.test.ts", unchanged: "expect(limit).toBe(1);" }],
      code: {
        path: "limit.ts",
        before: undefined,
        after: "export const limit = 2;",
      },
      diff: ["-export const limit = 1;", "+export const limit = 2;"],
      issue: ["issue", []],
      asked: "Adjust limit",
    },
  );
});

test("a Markdown-only PR asks for the whole-diff reviewer", async (t) => {
  const { collect } = await pullRequest(
    t,
    { "README.md": "# Otto\n" },
    { "README.md": "# Otto\n\nAn admin erases one person's data.\n" },
  );

  assert.deepEqual(await collect(), {
    status: "whole_diff",
    reason: "The change has no code or test file",
  });
});

test("a PR that adds more spec statements than the product evidence limit asks for the whole-diff reviewer", async (t) => {
  const statements = Array.from(
    { length: 60_000 },
    (_unused, index) => `- Booking ${index} shows its payer and its orderer.\n`,
  ).join("");
  const { collect } = await pullRequest(
    t,
    {
      "limit.ts": "export const limit = 1;",
      "specs/booking/spec.md": "# Bookings\n",
    },
    {
      "limit.ts": "export const limit = 2;",
      "specs/booking/spec.md": "# Bookings\n\n" + statements,
    },
  );

  assert.deepEqual(await collect(), {
    status: "whole_diff",
    reason: "Relevant product specifications exceed the review evidence limit",
  });
});
