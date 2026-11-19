import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { text } from "node:stream/consumers";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(
  new URL("./lore-review-readers.mjs", import.meta.url),
);

function runReaders(t, failedMode, extraFiles = []) {
  const root = mkdtempSync(join(tmpdir(), "review-test-"));

  t.after(() => rmSync(root, { recursive: true, force: true }));
  const skillDir = join(root, ".claude", "skills", "lore-review-files");

  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "Trusted reader instructions");
  writeFileSync(
    join(root, "claude"),
    `#!/usr/bin/env node
    const { readFileSync, readdirSync } = require("node:fs");
    const packet = JSON.parse(readFileSync(0, "utf8"));
    if (packet.mode === process.env.FAILED_MODE) process.exit(2);
    const seen = { packet, cwd: process.cwd(), names: readdirSync("."), args: process.argv.slice(2) };
    const schema = JSON.parse(seen.args[seen.args.indexOf("--json-schema") + 1]);
    if (schema.$schema && !schema.$schema.includes("draft-07")) process.exit(2);
    const status = process.env.FAILED_MODE === "missing evidence" && packet.mode === "tests" ? "incomplete" : "complete";
    const structured_output = { status, reading: ["First statement.", "Second statement."], evidence: [JSON.stringify(seen)], requests: [] };
    console.log(JSON.stringify({ subtype: "success", is_error: false, structured_output }));
  `,
    { mode: 0o700 },
  );
  const files = [
    {
      path: "src/rate.ts",
      role: "code",
      before: "return 2",
      after: "return 3",
    },
    {
      path: "src/rate.test.ts",
      role: "code",
      before: null,
      after: "expect(3)",
    },
    { path: "fixtures/rate.txt", role: "test", before: "3", after: "3" },
    { path: "docs/PR.MD", role: "code", before: null, after: "LEAK" },
    ...extraFiles,
  ];
  const result = spawnSync(
    process.execPath,
    [runner, "--reader-model", "small", "--reader-effort", "low"],
    {
      input: JSON.stringify({ files, issue: "LEAK" }),
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: root,
        CLAUDE_CONFIG_DIR: join(root, ".claude"),
        PATH: root + delimiter + process.env.PATH,
        FAILED_MODE: failedMode ?? "",
      },
    },
  );

  assert.ok(result.stdout, result.stderr);

  return { status: result.status, report: JSON.parse(result.stdout) };
}

test("three isolated readers receive code, tests and combined evidence with no Markdown or issue text", (t) => {
  const { status, report } = runReaders(t);

  assert.equal(status, 0);
  assert.equal(report.status, "readings_complete");
  const seen = report.readings.map(({ evidence }) => JSON.parse(evidence[0]));

  assert.deepEqual(
    seen.map(({ packet }) => packet.files.map(({ path }) => path)),
    [
      ["src/rate.ts"],
      ["src/rate.test.ts", "fixtures/rate.txt"],
      ["src/rate.ts", "src/rate.test.ts", "fixtures/rate.txt"],
    ],
  );
  assert.equal(new Set(seen.map(({ cwd }) => cwd)).size, 3);

  for (const { args, names, packet } of seen) {
    assert.deepEqual(names, []);
    assert.equal(args[args.indexOf("--tools") + 1], "");
    assert.ok(args.includes("--strict-mcp-config"));
    assert.ok(args.includes("--restricted"));
    assert.doesNotMatch(JSON.stringify(packet), /LEAK/);
  }
  assert.deepEqual(
    seen.map(({ args }) => args.includes("small") && args.includes("low")),
    [true, true, false],
  );
});

test("a failed test reader leaves the run incomplete and preserves the other two readings", (t) => {
  const { status, report } = runReaders(t, "tests");

  assert.equal(status, 1);
  assert.equal(report.status, "incomplete");
  assert.deepEqual(
    report.readings.map(({ mode, status }) => [mode, status]),
    [
      ["code", "complete"],
      ["tests", "incomplete"],
      ["test challenge", "complete"],
    ],
  );
});

test("a reader reporting missing material evidence leaves the run incomplete even after a successful process exit", (t) => {
  const { status, report } = runReaders(t, "missing evidence");

  assert.equal(status, 1);
  assert.equal(report.status, "incomplete");
});

test("a Rust source packet containing its inline test module asks for separate regions", (t) => {
  const { status, report } = runReaders(t, undefined, [
    {
      path: "src/lib.rs",
      role: "code",
      before: null,
      after:
        "pub fn rate() -> u8 { 3 }\n#[cfg(test)]\nmod tests { #[test] fn value() {} }",
    },
  ]);

  assert.equal(status, 1);
  assert.match(report.reason, /src\/lib\.rs/);
});

test("the shadow launcher isolates the three readings from discussion and specs", async (t) => {
  const uploads = new Map();
  const requests = [];
  const server = createServer(async (request, response) => {
    const body = JSON.parse(await text(request));

    requests.push(request.url);
    response.setHeader("Content-Type", "application/json");

    if (request.url.endsWith("/blobs")) {
      uploads.set(body.mode, body);
      response.end(JSON.stringify({ hash: body.mode }));

      return;
    }
    response.end(JSON.stringify({ run: { id: "shadow-run" } }));
    requests.push(body);
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const revision = "1".repeat(40);
  const prUrl = "https://ghe.example.com/re-cinq/lore/pull/4972";
  const discussion = [
    {
      source: "issue_comment",
      url: "https://github.com/re-cinq/lore/issues/4972#issuecomment-1",
      author: "maintainer",
      text: "Defer setting a configurable queue size.",
    },
  ];
  const specs = [
    { path: "spec.md", text: "The queue takes 25 items." },
    { path: "spec.md", text: "The queue takes 50 items.", version: "proposed" },
  ];
  const documents = [
    {
      path: "agents/queue.md",
      before: "Ask for the queue size.",
      after: "Pick the queue size.",
    },
  ];
  const child = spawn(
    process.execPath,
    [runner, "--shadow-revision", revision, "--shadow-pr-url", prUrl],
    {
      env: {
        ...process.env,
        FLOOR_API_URL: `http://127.0.0.1:${server.address().port}`,
        FLOOR_SERVICE_TOKEN: "test-token",
        GITHUB_HOST: "ghe.example.com",
      },
    },
  );

  child.stdin.end(
    JSON.stringify({
      files: [
        { path: "queue.ts", role: "code", before: "25", after: "50" },
        { path: "queue.test.ts", role: "test", before: "25", after: "25" },
        { path: "spec.md", role: "code", before: "a", after: "b" },
      ],
      discussion,
      specs,
      documents,
    }),
  );
  const [output, stderr, [exit]] = await Promise.all([
    text(child.stdout),
    text(child.stderr),
    once(child, "close"),
  ]);

  assert.equal(exit, 0, stderr || output);
  assert.deepEqual(JSON.parse(output), {
    status: "shadow_started",
    runId: "shadow-run",
    revision,
  });
  assert.deepEqual(Object.fromEntries(uploads), {
    code: {
      mode: "code",
      files: [{ path: "queue.ts", before: "25", after: "50" }],
    },
    tests: {
      mode: "tests",
      files: [{ path: "queue.test.ts", unchanged: "25" }],
    },
    "test challenge": {
      mode: "test challenge",
      files: [
        { path: "queue.ts", before: "25", after: "50" },
        { path: "queue.test.ts", unchanged: "25" },
      ],
    },
    intent: { mode: "intent", discussion },
    product: {
      mode: "product",
      specs: [{ ...specs[0], version: "existing" }, specs[1]],
      documents,
    },
  });
  const start = requests.at(-1);

  assert.equal(requests.at(-2), "/assembly-lines/code-review-shadow/start");
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(start.startItems).map(([name, { kind, ref }]) => [
        name,
        [kind, ref],
      ]),
    ),
    {
      review_key: ["value", `${prUrl}@${revision}`],
      revision: ["value", revision],
      pr_url: ["value", prUrl],
      code_evidence: ["file", "code"],
      test_evidence: ["file", "tests"],
      challenge_evidence: ["file", "test challenge"],
      intent_evidence: ["file", "intent"],
      product_evidence: ["file", "product"],
    },
  );
  assert.deepEqual(Object.keys(start), ["repo", "startItems"]);
  assert.equal(start.repo, "ghe.example.com/re-cinq/lore");
});

test("an automatic run reuses the prior settled run for the same PR and revision", async (t) => {
  const revision = "1".repeat(40);
  const prUrl = "https://github.com/re-cinq/lore/pull/4972";
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");

    requests.push([
      request.method,
      url.pathname,
      Object.fromEntries(url.searchParams),
    ]);
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        items: [
          {
            id: "previous-run",
            finishedAt: "2026-11-19T10:30:00Z",
            startItems: { automatic: { ref: "true" } },
          },
        ],
        nextCursor: null,
      }),
    );
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const child = spawn(
    process.execPath,
    [
      runner,
      "--shadow-revision",
      revision,
      "--shadow-pr-url",
      prUrl,
      "--automatic",
    ],
    {
      env: {
        ...process.env,
        FLOOR_API_URL: `http://127.0.0.1:${server.address().port}`,
        FLOOR_SERVICE_TOKEN: "test-token",
        GITHUB_HOST: "github.com",
      },
    },
  );

  child.stdin.end(JSON.stringify({ files: [] }));
  const [output, stderr, [exit]] = await Promise.all([
    text(child.stdout),
    text(child.stderr),
    once(child, "close"),
  ]);

  assert.equal(exit, 0, stderr || output);
  assert.deepEqual(JSON.parse(output), {
    status: "shadow_started",
    runId: "previous-run",
    revision,
  });
  assert.deepEqual(requests, [
    [
      "GET",
      "/assembly-runs",
      {
        line: "code-review-shadow",
        repo: "github.com/re-cinq/lore",
        subject: `review_key:${prUrl}@${revision}`,
      },
    ],
  ]);
});

test("a preparation failure opens the incomplete publication node without using stdin", async (t) => {
  const revision = "2".repeat(40);
  const prUrl = "https://github.com/re-cinq/lore/pull/4972";
  const requests = [];
  const server = createServer(async (request, response) => {
    const body = JSON.parse(await text(request));

    requests.push({ path: request.url, body });
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify(
        request.url.endsWith("/blobs")
          ? { hash: "empty" }
          : { run: { id: "incomplete-run" } },
      ),
    );
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const child = spawn(
    process.execPath,
    [
      runner,
      "--shadow-revision",
      revision,
      "--shadow-pr-url",
      prUrl,
      "--shadow-incomplete",
    ],
    {
      env: {
        ...process.env,
        FLOOR_API_URL: "http://127.0.0.1:" + server.address().port,
        FLOOR_SERVICE_TOKEN: "test-token",
        GITHUB_HOST: "github.com",
      },
    },
  );

  child.stdin.end();
  const [output, stderr, [exit]] = await Promise.all([
    text(child.stdout),
    text(child.stderr),
    once(child, "close"),
  ]);

  assert.equal(exit, 0, stderr || output);
  assert.deepEqual(JSON.parse(output), {
    status: "shadow_started",
    runId: "incomplete-run",
    revision,
  });
  const start = requests[1]?.body;

  assert.deepEqual(
    requests.map(({ path }) => path),
    ["/blobs", "/assembly-lines/code-review-shadow/start"],
  );
  assert.deepEqual(requests[0]?.body, {});
  assert.equal(start?.entry, "publish-incomplete");
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(start?.startItems ?? {}).map(([name, item]) => [
        name,
        item.ref,
      ]),
    ),
    {
      review_key: prUrl + "@" + revision,
      revision,
      pr_url: prUrl,
      preparation_failed: "true",
      code_evidence: "empty",
      test_evidence: "empty",
      challenge_evidence: "empty",
      intent_evidence: "empty",
      product_evidence: "empty",
    },
  );
});
