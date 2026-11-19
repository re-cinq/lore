import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { text } from "node:stream/consumers";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

test("a PR event collects pinned code and unchanged tests and starts a five-pass run for the PR head", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "lore-pr-test-"));

  t.after(() => rm(root, { force: true, recursive: true }));
  const repository = join(root, "origin");

  await mkdir(repository);
  const git = (...args) =>
    execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();

  git("init", "-q");
  git("config", "user.email", "test@example.org");
  git("config", "user.name", "Collector test");
  await writeFile(join(repository, "limit.ts"), "export const limit = 1;");
  await writeFile(join(repository, "limit.test.ts"), "expect(limit).toBe(1);");
  git("add", ".");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");

  await writeFile(join(repository, "limit.ts"), "export const limit = 2;");
  git("commit", "-qam", "head");
  const head = git("rev-parse", "HEAD");
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
  const packets = new Map();
  let started;
  const floor = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");

    if (req.url.startsWith("/assembly-runs?")) {
      return res.end(JSON.stringify({ items: [], nextCursor: null }));
    }
    const body = JSON.parse(await text(req));

    if (req.url === "/blobs") {
      packets.set(body.mode, body);

      return res.end(JSON.stringify({ hash: body.mode }));
    }
    started = body;
    res.end(JSON.stringify({ run: { id: "run-42" } }));
  });

  floor.listen(0, "127.0.0.1");
  await once(floor, "listening");
  t.after(() => floor.close());
  const run = promisify(execFile);
  const result = await run(
    process.execPath,
    [
      fileURLToPath(new URL("./lore-review-pr.mjs", import.meta.url)),
      "--repo",
      "acme/pilot",
      "--pr",
      "42",
      "--head",
      head,
    ],
    {
      env: {
        PATH: root + ":" + process.env.PATH,
        HOME: root,
        GITHUB_TOKEN: "fixture-token",
        NODE_OPTIONS: "--import=" + mock,
        FLOOR_API_URL: "http://127.0.0.1:" + floor.address().port,
        FLOOR_SERVICE_TOKEN: "fixture-floor",
      },
    },
  );

  assert.equal(JSON.parse(result.stdout).runId, "run-42");
  assert.equal(started.startItems.revision.ref, head);
  assert.deepEqual(packets.get("tests").files, [
    { path: "limit.test.ts", unchanged: "expect(limit).toBe(1);" },
  ]);
  assert.deepEqual(packets.get("code").files, [
    {
      path: "limit.ts",
      before: "export const limit = 1;",
      after: "export const limit = 2;",
    },
  ]);
  assert.equal(packets.get("intent").discussion[0].text, "Adjust limit");
});
