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

test("the shadow launcher uploads separate packets and starts one line without a checkout", async (t) => {
  const uploads = new Map();
  const requests = [];
  const server = createServer(async (request, response) => {
    const body = JSON.parse(await text(request));

    requests.push(request.url);
    response.setHeader("Content-Type", "application/json");

    if (request.url.endsWith("/blobs")) {
      uploads.set(
        body.mode,
        body.files.map(({ path }) => path),
      );
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
  const child = spawn(
    process.execPath,
    [runner, "--shadow-revision", revision],
    {
      env: {
        ...process.env,
        FLOOR_API_URL: `http://127.0.0.1:${server.address().port}`,
        FLOOR_SERVICE_TOKEN: "test-token",
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
    code: ["queue.ts"],
    tests: ["queue.test.ts"],
    "test challenge": ["queue.ts", "queue.test.ts"],
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
      revision: ["value", revision],
      code_evidence: ["file", "code"],
      test_evidence: ["file", "tests"],
      challenge_evidence: ["file", "test challenge"],
    },
  );
  assert.deepEqual(Object.keys(start), ["startItems"]);
});
