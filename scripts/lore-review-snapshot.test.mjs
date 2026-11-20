import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("./lore-review-snapshot.mjs", import.meta.url),
);

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), "lore-snapshot-test-"));

  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  function git(...args) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);

    return result.stdout.trim();
  }
  git("init", "-q");
  git("config", "user.name", "Snapshot Test");
  git("config", "user.email", "snapshot@example.test");
  function write(path, body) {
    const destination = join(cwd, path);

    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, body);
  }
  function commit() {
    git("add", "-A");
    git("commit", "-qm", "commit evidence");

    return git("rev-parse", "HEAD");
  }
  function snapshot(base, head, ...options) {
    const result = spawnSync(
      process.execPath,
      [script, "--base", base, "--head", head, ...options],
      { cwd, encoding: "utf8" },
    );

    return { exitCode: result.status, output: JSON.parse(result.stdout) };
  }

  return { git, write, commit, snapshot };
}

test("captures committed changes, callers, tests and fixtures from a diverged comparison", (t) => {
  const { git, write, commit, snapshot } = repository(t);
  const original = "export const access = false;\n";
  const changed = "export const access = true;\n";
  const caller = "import { access } from './access';\n";
  const assertion = "const example = './fixtures/sample.json';\n";
  const fixture = "{}\n";

  write("src/access.ts", original);
  write("src/consumer.ts", caller);
  write("src/access.test.ts", assertion);
  write("src/fixtures/sample.json", fixture);
  write("src/legacy.ts", "export const legacy = false;\n");
  const mergeBase = commit();

  git("checkout", "-qb", "base");
  write("unrelated.ts", "base-only change\n");
  const base = commit();

  git("checkout", "-qb", "pr", mergeBase);
  write("src/access.ts", changed);
  write("notes.MDX", "access briefing\n");
  git("mv", "src/legacy.ts", "src/legacy.test.ts");
  const head = commit();

  write("src/access.ts", "dirty working tree\n");
  assert.deepEqual(snapshot(base, head), {
    exitCode: 0,
    output: {
      base,
      head,
      mergeBase,
      files: [
        {
          path: "src/access.test.ts",
          role: "test",
          before: assertion,
          after: assertion,
        },
        {
          path: "src/access.ts",
          role: "code",
          before: original,
          after: changed,
        },
        {
          path: "src/consumer.ts",
          role: "code",
          before: caller,
          after: caller,
          context: true,
        },
        {
          path: "src/legacy.test.ts",
          role: "test",
          before: null,
          after: "export const legacy = false;\n",
        },
        {
          path: "src/legacy.ts",
          role: "code",
          before: "export const legacy = false;\n",
          after: null,
        },
        {
          path: "src/fixtures/sample.json",
          role: "test",
          before: fixture,
          after: fixture,
        },
      ],
      terms: ["access", "legacy"],
    },
  });
});

test("a changed binary asks for the whole-diff reviewer", (t) => {
  const { write, commit, snapshot } = repository(t);

  write("status.ts", "export const status = 'ready';\n");
  const base = commit();

  write("settings.bin", Buffer.from([0, 1, 2]));
  const head = commit();

  assert.deepEqual(snapshot(base, head), {
    exitCode: 1,
    output: {
      status: "whole_diff",
      reason: "Binary evidence for settings.bin",
    },
  });
});

test("a change with more than 2 MiB of evidence asks for the whole-diff reviewer", (t) => {
  const { write, commit, snapshot } = repository(t);

  write("table.ts", "export const rows = [];\n");
  const base = commit();

  write(
    "table.ts",
    "export const rows = [\n" + "  1,\n".repeat(600_000) + "];\n",
  );
  const head = commit();

  assert.deepEqual(snapshot(base, head), {
    exitCode: 1,
    output: { status: "whole_diff", reason: "Evidence exceeds 2097152 bytes" },
  });
});

test("a Markdown-only change asks for the whole-diff reviewer", (t) => {
  const { write, commit, snapshot } = repository(t);

  write("README.md", "# Otto\n");
  const base = commit();

  write("README.md", "# Otto\n\nAn admin erases one person's data.\n");
  const head = commit();

  assert.deepEqual(snapshot(base, head), {
    exitCode: 1,
    output: {
      status: "whole_diff",
      reason: "The change has no code or test file",
    },
  });
});

test("a Rust file holding its own test module asks for the whole-diff reviewer", (t) => {
  const { write, commit, snapshot } = repository(t);

  write("src/limit.rs", "pub const LIMIT: u8 = 1;\n");
  const base = commit();

  write(
    "src/limit.rs",
    "pub const LIMIT: u8 = 2;\n#[cfg(test)]\nmod tests {}\n",
  );
  const head = commit();

  assert.deepEqual(snapshot(base, head), {
    exitCode: 1,
    output: {
      status: "whole_diff",
      reason:
        "Mixed code and inline tests require separately filtered evidence in src/limit.rs",
    },
  });
});

test("reports an explicitly requested path absent from both commits", (t) => {
  const { write, commit, snapshot } = repository(t);

  write("status.ts", "export const status = 'ready';\n");
  const head = commit();

  assert.deepEqual(snapshot(head, head, "--include", "missing.ts"), {
    exitCode: 1,
    output: {
      status: "incomplete",
      reason: "Evidence path absent from both revisions: missing.ts",
    },
  });
});

test("a changed middleware includes an unchanged file route without an import", (t) => {
  const { write, commit, snapshot } = repository(t);

  write("web/src/middleware.ts", "export const locale = 'en';");
  write("web/src/app/files/route.ts", "export const GET = () => 'files';");
  const base = commit();

  write("web/src/middleware.ts", "export const locale = 'de';");
  const result = snapshot(base, commit());

  assert.deepEqual(
    result.output.files.map((file) => file.path),
    ["web/src/app/files/route.ts", "web/src/middleware.ts"],
  );
});

test("a test-only change includes its unchanged implementation as verification evidence", (t) => {
  const { write, commit, snapshot } = repository(t);

  write("src/rate.ts", "export const rate = 3;");
  write("src/rate.test.ts", "import {rate} from './rate.js';");
  const base = commit();

  write(
    "src/rate.test.ts",
    "import {rate} from './rate.js'; expect(rate).toBe(3);",
  );
  const result = snapshot(base, commit());

  assert.deepEqual(
    result.output.files.map((file) => file.path),
    ["src/rate.test.ts", "src/rate.ts"],
  );
});

test("a removed YAML environment key includes unchanged code and tests that read it", (t) => {
  const { write, commit, snapshot } = repository(t);

  write("deploy.yaml", "env:\n  PACK_REPO: example/pack\n");
  write("src/config.ts", "export const pack = env => env.PACK_REPO || null;");
  write(
    "src/config.test.ts",
    "expect(pack({PACK_REPO: 'example/pack'})).toBe('example/pack');",
  );
  const base = commit();

  write("deploy.yaml", "env: {}\n");
  const head = commit();
  const { exitCode, output } = snapshot(base, head);

  assert.equal(exitCode, 0);
  assert.deepEqual(
    output.files.map(({ path, role }) => [path, role]),
    [
      ["deploy.yaml", "code"],
      ["src/config.test.ts", "test"],
      ["src/config.ts", "code"],
    ],
  );
});
