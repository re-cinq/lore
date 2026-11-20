import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { text } from "node:stream/consumers";
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
  const floorRun = { packets: new Map(), started: undefined };
  const floor = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");

    if (req.url.startsWith("/assembly-runs?")) {
      return res.end(JSON.stringify({ items: [], nextCursor: null }));
    }
    const body = JSON.parse(await text(req));

    if (req.url === "/blobs") {
      floorRun.packets.set(body.mode, body);

      return res.end(JSON.stringify({ hash: body.mode }));
    }
    floorRun.started = body;
    res.end(JSON.stringify({ run: { id: "run-42" } }));
  });

  floor.listen(0, "127.0.0.1");
  await once(floor, "listening");
  t.after(() => floor.close());
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
      FLOOR_API_URL: "http://127.0.0.1:" + floor.address().port,
      FLOOR_SERVICE_TOKEN: "fixture-floor",
    },
  };
  const collect = async (...extra) =>
    JSON.parse(
      (await run(process.execPath, [...args, ...extra], options)).stdout,
    );

  return { base, head, collect, floorRun };
}

test("a PR event collects pinned code and unchanged tests and starts a five-pass run for the PR head", async (t) => {
  const { base, head, collect, floorRun } = await pullRequest(
    t,
    {
      "limit.ts": "export const limit = 1;",
      "limit.test.ts": "expect(limit).toBe(1);",
    },
    { "limit.ts": "export const limit = 2;" },
  );
  const evidence = await collect("--evidence-only", "--since", base);

  assert.equal(floorRun.started, undefined);
  assert.deepEqual(Object.keys(evidence).sort(), [
    "challenge_evidence",
    "code_evidence",
    "intent_evidence",
    "product_evidence",
    "test_evidence",
  ]);
  assert.deepEqual(
    evidence.test_evidence.files.map((file) => file.path),
    ["limit.test.ts"],
  );
  assert.deepEqual(
    evidence.code_evidence.files.map((file) => file.path),
    ["limit.ts"],
  );
  const result = await collect();

  assert.equal(result.runId, "run-42");
  assert.equal(floorRun.started.startItems.revision.ref, head);
  assert.deepEqual(floorRun.packets.get("tests").files, [
    { path: "limit.test.ts", unchanged: "expect(limit).toBe(1);" },
  ]);
  assert.deepEqual(floorRun.packets.get("code").files, [
    {
      path: "limit.ts",
      before: "export const limit = 1;",
      after: "export const limit = 2;",
    },
  ]);
  assert.equal(
    floorRun.packets.get("intent").discussion[0].text,
    "Adjust limit",
  );
});

test("a Markdown-only PR asks for the whole-diff reviewer and starts no five-pass run", async (t) => {
  const { collect, floorRun } = await pullRequest(
    t,
    { "README.md": "# Otto\n" },
    { "README.md": "# Otto\n\nAn admin erases one person's data.\n" },
  );
  const asked = {
    status: "whole_diff",
    reason: "The change has no code or test file",
  };

  assert.deepEqual(
    [await collect("--evidence-only"), await collect(), floorRun.started],
    [asked, asked, undefined],
  );
});

test("a PR whose specs exceed the product evidence limit asks for the whole-diff reviewer", async (t) => {
  const megabyte = "A booking shows its payer.\n".repeat(45_000);
  const { collect } = await pullRequest(
    t,
    {
      "limit.ts": "export const limit = 1;",
      "specs/booking/spec.md": megabyte,
    },
    {
      "limit.ts": "export const limit = 2;",
      "specs/booking/spec.md": megabyte + "It ends.\n",
    },
  );

  assert.deepEqual(await collect("--evidence-only"), {
    status: "whole_diff",
    reason: "Relevant product specifications exceed the review evidence limit",
  });
});
