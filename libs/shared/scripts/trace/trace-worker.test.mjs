import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const scripts = dirname(fileURLToPath(import.meta.url));
const repository = resolve(scripts, "../../../..");
const file = "apps/fixture/src/cases.test.js";
const source = `import { describe, it, expect } from "vitest";
describe("old", () => {
  it("renders", () => expect("old").toEqual("old"));
});
describe("new > literal", () => {
  it("renders", () => expect("new").toEqual("new"));
});
it.each([1, 2])("parameter %s", value => expect(value).toEqual(1));
it.each([1, 1])("repeated %s", value => expect(value).toEqual(1));
it.skip("static skip", () => expect(false).toEqual(true));
it.todo("todo case");
it("runtime skip", ({ skip }) => { skip(); expect(false).toEqual(true); });
it.fails("expected failure", () => expect(1).toEqual(2));
it("same title", () => expect(1).toEqual(1));
it("same title", () => expect(2).toEqual(2));
`;

function fixture(config = "export default {}", contents = source) {
  const root = mkdtempSync(join(tmpdir(), "lore-trace-native-"));
  const pkg = join(root, "apps/fixture");

  mkdirSync(join(pkg, "src"), { recursive: true });
  symlinkSync(
    join(repository, "node_modules"),
    join(root, "node_modules"),
    "dir",
  );
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(pkg, "vitest.config.mjs"), config);
  writeFileSync(join(root, file), contents);

  return root;
}

function runWorker(root) {
  const filesPath = join(root, "files.json");
  const outPath = join(root, "out.json");

  writeFileSync(filesPath, JSON.stringify([file]));
  execFileSync(
    process.execPath,
    [
      join(scripts, "trace-worker.mjs"),
      root,
      "apps/fixture",
      filesPath,
      outPath,
    ],
    {
      cwd: join(root, "apps/fixture"),
      stdio: "pipe",
      timeout: 60000,
    },
  );

  return JSON.parse(readFileSync(outPath, "utf8"))[file];
}

test(
  "native snapshots retain duplicate ids, parameter failures, dynamic skips and declaration locations",
  { timeout: 60000 },
  () => {
    const root = fixture();

    try {
      writeFileSync(
        join(root, "apps/fixture/src/other.test.js"),
        'import { it, expect } from "vitest";\nit("other file", () => expect(1).toEqual(1));\n',
      );
      const discovered = JSON.parse(
        execFileSync(process.execPath, [join(scripts, "list-tests.mjs")], {
          cwd: root,
          env: {
            ...process.env,
            LORE_TRACE_PKGS: "apps/fixture",
            LORE_TRACE_SCOPE: "src",
          },
          encoding: "utf8",
          timeout: 60000,
        }),
      );
      const result = runWorker(root);
      const cases = result.tests;
      const discoveredCases = discovered.filter((entry) => entry.file === file);
      const named = (name) => cases.filter((entry) => entry.name === name);

      assert.equal(result.passed, false);
      assert.equal(cases.length, 12);
      assert.equal(
        new Set(cases.map((entry) => entry.runnerId)).size,
        cases.length,
      );
      assert.deepEqual(
        discoveredCases.map((entry) => entry.runnerId).sort(),
        cases.map((entry) => entry.runnerId).sort(),
      );
      assert.equal(
        cases.every((entry) => entry.execution.fileCaseCount === 12),
        true,
      );
      assert.equal(
        discoveredCases.every((entry) => entry.execution.fileCaseCount === 12),
        true,
      );
      assert.deepEqual(
        discovered
          .filter((entry) => entry.file !== file)
          .map((entry) => entry.execution.fileCaseCount),
        [1],
      );
      assert.equal(
        discovered.every((entry) => entry.execution.status === "unknown"),
        true,
      );
      assert.deepEqual(named("old > renders")[0].execution.location, {
        line: 3,
        column: 3,
      });
      assert.deepEqual(named("new > literal > renders")[0].suite, [
        "new > literal",
      ]);
      assert.deepEqual(named("new > literal > renders")[0].execution.location, {
        line: 6,
        column: 3,
      });
      assert.deepEqual(named("parameter 1")[0].execution.status, "passed");
      assert.deepEqual(named("parameter 2")[0].execution.status, "failed");
      assert.deepEqual(
        named("repeated 1").map((entry) => entry.execution.location.line),
        [9, 9],
      );
      assert.deepEqual(
        ["static skip", "todo case", "runtime skip"].map(
          (name) => named(name)[0].execution.status,
        ),
        ["skipped", "skipped", "skipped"],
      );
      assert.deepEqual(named("expected failure")[0].execution, {
        status: "passed",
        location: { line: 13, column: 4 },
        expectedFailure: true,
        fileCaseCount: 12,
      });
      assert.equal(named("same title").length, 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  "single-file fallback and run_many preserve the same native case snapshot",
  { timeout: 60000 },
  () => {
    const root = fixture();

    try {
      const one = JSON.parse(
        execFileSync(process.execPath, [join(scripts, "run-test.mjs"), file], {
          cwd: root,
          encoding: "utf8",
          timeout: 60000,
        }),
      );
      const many = spawnSync(
        process.execPath,
        [join(scripts, "run-many.mjs")],
        {
          cwd: root,
          env: { ...process.env, LORE_TRACE_WORKERS: "1" },
          input: file + "\n",
          encoding: "utf8",
          timeout: 60000,
        },
      );

      assert.equal(many.status, 0, many.stderr);
      assert.equal(one.tests.length, 12);
      assert.deepEqual(JSON.parse(many.stdout)[file].tests, one.tests);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  "both projects retain their own native ids for the same test module",
  { timeout: 60000 },
  () => {
    const root = fixture(
      `export default { test: { projects: [
    { test: { name: "first", include: ["src/cases.test.js"] } },
    { test: { name: "second", include: ["src/cases.test.js"] } }
  ] } }`,
      'import { it, expect } from "vitest";\nit("renders", () => expect(1).toEqual(1));\n',
    );

    try {
      const result = runWorker(root);

      assert.equal(result.passed, true);
      assert.deepEqual(
        result.tests.map((entry) => JSON.parse(entry.runnerId)[1]).sort(),
        ["first", "second"],
      );
      assert.deepEqual(
        result.tests.map((entry) => entry.execution.status),
        ["passed", "passed"],
      );
      assert.deepEqual(
        result.tests.map((entry) => entry.execution.fileCaseCount),
        [2, 2],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  "a teardown error leaves the otherwise passed case unknown",
  { timeout: 60000 },
  () => {
    const root = fixture(
      "export default {}",
      `import { it, afterAll, expect } from "vitest";
it("renders", () => expect(1).toEqual(1));
afterAll(() => { throw new Error("teardown failed"); });
`,
    );

    try {
      const result = runWorker(root);

      assert.equal(result.passed, false);
      assert.equal(result.tests[0].execution.status, "unknown");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
