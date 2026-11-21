import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { promisify, parseArgs } from "node:util";
import { isTestFile } from "../libs/shared/dist/domain/test-paths.js";
import { referenceStem } from "./lore-review-packets.mjs";

const runFile = promisify(execFile);
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const markdown = /\.(?:md|mdx|markdown|mkd|mkdn|mdown)$/i;
const testDirectory = /(?:^|\/)(?:tests?|__mocks__|__fixtures__|fixtures)\//i;
const maxEvidenceBytes = 2 * 1024 * 1024;

// A change the collector cannot hand to the code and test readers; the whole-diff reviewer takes it.
class UnsplittableChange extends Error {}

async function git(args, { emptyOnNoMatch = false, env = {} } = {}) {
  try {
    const { stdout } = await runFile("git", ["--no-replace-objects", ...args], {
      encoding: "buffer",
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GIT_NO_LAZY_FETCH: "1", ...env },
    });

    return stdout;
  } catch (error) {
    if (emptyOnNoMatch && error.code === 1) {
      return Buffer.alloc(0);
    }
    throw new Error(
      `Git ${args[0]} failed: ${error.stderr?.toString().trim() || error.message}`,
    );
  }
}

function records(bytes) {
  return decoder.decode(bytes).split("\0").slice(0, -1);
}

// The paths the revision's .gitattributes marks linguist-generated. Read through a throwaway index: the image's git (2.39) has no check-attr --source.
async function generatedPaths(revision, paths) {
  if (paths.length === 0) {
    return new Set();
  }
  const env = {
    GIT_INDEX_FILE: join(tmpdir(), `lore-review-attributes-${process.pid}`),
  };

  try {
    await git(["read-tree", revision], { env });
    const fields = records(
      await git(
        ["check-attr", "--cached", "-z", "linguist-generated", "--", ...paths],
        { env },
      ),
    );
    const generated = new Set();

    for (let index = 0; index < fields.length; index += 3) {
      if (["set", "true"].includes(fields[index + 2])) {
        generated.add(fields[index]);
      }
    }

    return generated;
  } finally {
    await rm(env.GIT_INDEX_FILE, { force: true });
  }
}

function enforceEvidenceLimit(bytes) {
  if (bytes > maxEvidenceBytes) {
    throw new UnsplittableChange(`Evidence exceeds ${maxEvidenceBytes} bytes`);
  }
}

async function tree(revision) {
  const entries = records(
    await git(["ls-tree", "--full-tree", "-r", "-z", revision]),
  );

  return new Map(
    entries.map((entry) => {
      const separator = entry.indexOf("\t");
      const [mode, , hash] = entry.slice(0, separator).split(" ");

      return [entry.slice(separator + 1), { mode, hash }];
    }),
  );
}

async function referencedPaths(revision, stems, pathspecs = []) {
  if (stems.length === 0) {
    return [];
  }
  const paths = records(
    await git(
      [
        "grep",
        "--full-name",
        "--no-textconv",
        "-I",
        "-l",
        "-z",
        "-F",
        "-w",
        ...stems.flatMap((stem) => ["-e", stem]),
        revision,
        "--",
        ...pathspecs,
      ],
      { emptyOnNoMatch: true },
    ),
  );

  return paths.map((path) => path.slice(revision.length + 1));
}

async function changedEnvironmentKeys(base, head, changed) {
  const yaml = changed.filter((path) => /\.ya?ml$/i.test(path));

  if (!yaml.length) {
    return [];
  }
  const diff = await git([
    "diff",
    "--no-ext-diff",
    "--unified=0",
    base,
    head,
    "--",
    ...yaml.map((path) => ":(literal)" + path),
  ]);
  const declarations =
    /^[+-]\s*(?:-\s+name:\s*([A-Z][A-Z0-9_]+)\s*$|([A-Z][A-Z0-9_]+):)/gm;

  return [
    ...new Set(
      [...decoder.decode(diff).matchAll(declarations)].map(
        (match) => match[1] ?? match[2],
      ),
    ),
  ];
}

const sourceGlobs = [
  "*.ts",
  "*.tsx",
  "*.js",
  "*.jsx",
  "*.mjs",
  "*.cjs",
  "*.py",
  "*.go",
  "*.rs",
  "*.java",
  "*.kt",
  "*.rb",
  "*.sh",
  "*.cs",
];
const jsSource = /\.[cm]?[jt]sx?$/;
const moduleName = (path) => path.replace(jsSource, "").replace(/\/index$/, "");

async function moduleConsumers(revision, changed) {
  if (!changed.length) {
    return [];
  }
  const names = changed
    .map((path) => posix.basename(moduleName(path)))
    .filter(Boolean);

  if (!names.length) {
    return [];
  }
  const escape = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = `["']([^"']*/)?(${[...new Set(names)].map(escape).join("|")})(\\.[cm]?[jt]sx?)?["']`;
  const matches = decoder.decode(
    await git(
      [
        "grep",
        "--no-textconv",
        "-I",
        "-o",
        "-z",
        "-E",
        "-e",
        pattern,
        revision,
        "--",
        "*.ts",
        "*.tsx",
        "*.js",
        "*.jsx",
        "*.mts",
        "*.mjs",
        "*.cts",
        "*.cjs",
      ],
      { emptyOnNoMatch: true },
    ),
  );
  const modules = new Set(changed.map(moduleName));
  const consumers = new Set();

  for (const [, path, ref] of matches.matchAll(
    /[^:\0\n]+:([^\0]+)\0["']([^"'\n]+)["']\n/g,
  )) {
    if (ref.startsWith(".")) {
      if (modules.has(moduleName(posix.join(posix.dirname(path), ref)))) {
        consumers.add(path);
      }
    } else if (
      ref.includes("/") &&
      changed.some((file) =>
        moduleName(file).endsWith(
          "/" + moduleName(ref).split("/").slice(-2).join("/"),
        ),
      )
    ) {
      consumers.add(path);
    }
  }

  return [...consumers];
}

async function source(path, entry) {
  if (!entry) {
    return null;
  }

  if (!/^100(?:644|755)$/.test(entry.mode)) {
    throw new UnsplittableChange(
      `Unsupported Git file mode ${entry.mode} for ${path}`,
    );
  }
  const bytes = await git(["cat-file", "blob", entry.hash]);

  if (bytes.includes(0)) {
    throw new UnsplittableChange(`Binary evidence for ${path}`);
  }
  let body;

  try {
    body = decoder.decode(bytes);
  } catch {
    throw new UnsplittableChange(`Evidence for ${path} is not UTF-8`);
  }

  if (body.startsWith("version https://git-lfs.github.com/spec/v1\n")) {
    throw new UnsplittableChange(`Git LFS evidence unavailable for ${path}`);
  }

  return body;
}

function pathsUsedByTests(file, trees) {
  const paths = new Set();

  for (const [body, entries] of [
    [file.before, trees[0]],
    [file.after, trees[1]],
  ]) {
    for (const [, reference] of (body ?? "").matchAll(
      /["'`]((?:\.\.?\/)[^"'`\r\n]+)["'`]/g,
    )) {
      const path = posix.normalize(
        posix.join(posix.dirname(file.path), reference),
      );

      if (testDirectory.test(path) && entries.has(path)) {
        paths.add(path);
      }
    }
  }

  return paths;
}

async function modulesUsedByChangedTests(changed, entries) {
  const modules = new Map();

  for (const path of entries.keys()) {
    if (jsSource.test(path)) {
      modules.set(moduleName(path), path);
    }
  }
  const imported = new Set();

  for (const path of changed) {
    if (
      !jsSource.test(path) ||
      !(isTestFile(path) || testDirectory.test(path))
    ) {
      continue;
    }
    const body = await source(path, entries.get(path));

    for (const [, reference] of (body ?? "").matchAll(
      /["'](\.\.?\/[^"'\n]+)["']/g,
    )) {
      const target = modules.get(
        moduleName(posix.join(posix.dirname(path), reference)),
      );

      if (target) {
        imported.add(target);
      }
    }
  }

  return [...imported];
}

async function capture(base, head, includes, comparisonBase, scope) {
  for (const [name, sha] of [
    ["base", base],
    ["head", head],
  ]) {
    if (!/^[0-9a-f]{40}$/.test(sha ?? "")) {
      throw new Error(`--${name} requires a full Git commit SHA`);
    }
  }
  const [baseType, headType, bases] = await Promise.all([
    git(["cat-file", "-t", base]),
    git(["cat-file", "-t", head]),
    comparisonBase && /^[0-9a-f]{40}$/.test(comparisonBase)
      ? git(["rev-parse", "--verify", comparisonBase + "^{commit}"])
      : git(["merge-base", "--all", base, head]),
  ]);
  const mergeBases = bases.toString().trim().split("\n");

  if (
    baseType.toString().trim() !== "commit" ||
    headType.toString().trim() !== "commit" ||
    mergeBases.length !== 1
  ) {
    throw new Error("Review requires two commits with a unique merge base");
  }
  const [mergeBase] = mergeBases;
  const [changedBytes, beforeTree, afterTree] = await Promise.all([
    git([
      "diff",
      "--no-ext-diff",
      "--name-only",
      "-z",
      "--no-renames",
      "--ignore-submodules=none",
      mergeBase,
      head,
      "--",
      ...scope.map((path) => ":(literal)" + path),
    ]),
    tree(mergeBase),
    tree(head),
  ]);
  const changed = records(changedBytes).filter((path) => !markdown.test(path));
  const generated = await generatedPaths(head, changed);
  const stems = [...new Set(changed.map(referenceStem))].filter(Boolean);
  const imported = await Promise.all([
    modulesUsedByChangedTests(changed, beforeTree),
    modulesUsedByChangedTests(changed, afterTree),
  ]);
  const jsPaths = [
    ...new Set([
      ...changed.filter((path) => jsSource.test(path)),
      ...imported.flat(),
    ]),
  ];
  const otherStems = [
    ...new Set(
      changed
        .filter((path) => !jsSource.test(path))
        .map((path) =>
          /\.(?:ya?ml|json)$/.test(path)
            ? posix.basename(path)
            : referenceStem(path),
        ),
    ),
  ].filter(Boolean);
  const configKeys = await changedEnvironmentKeys(mergeBase, head, changed);
  const related = await Promise.all([
    referencedPaths(mergeBase, configKeys, sourceGlobs),
    referencedPaths(head, configKeys, sourceGlobs),
    moduleConsumers(mergeBase, jsPaths),
    moduleConsumers(head, jsPaths),
    referencedPaths(mergeBase, otherStems),
    referencedPaths(head, otherStems),
  ]);
  const middlewareRoots = jsPaths
    .filter((path) => /(?:^|\/)(?:middleware|proxy)\.[jt]s$/.test(path))
    .map((path) => posix.dirname(path));
  const paths = new Set([...changed, ...includes, ...imported.flat()]);
  const changedDirectories = new Set(changed.map(posix.dirname));

  for (const path of new Set([...beforeTree.keys(), ...afterTree.keys()])) {
    if (
      middlewareRoots.some((root) =>
        /^(?:app\/(?:.*\/)?route\.[cm]?[jt]s|pages\/api\/.+\.[cm]?[jt]s)$/.test(
          posix.relative(root, path),
        ),
      )
    ) {
      paths.add(path);
    }

    if (
      changedDirectories.has(posix.dirname(path)) &&
      (isTestFile(path) || testDirectory.test(path)) &&
      stems.includes(referenceStem(path))
    ) {
      paths.add(path);
    }
  }

  // What the change is about; a file found only by a search for its uses is context.
  const subject = new Set(paths);

  for (const path of related.flat()) {
    paths.add(path);
  }

  const files = [];
  let totalBytes = 0;

  async function addFile(path) {
    if (markdown.test(path)) {
      return;
    }
    const beforeEntry = beforeTree.get(path);
    const afterEntry = afterTree.get(path);

    if (!beforeEntry && !afterEntry) {
      throw new Error(`Evidence path absent from both revisions: ${path}`);
    }

    if (beforeEntry && afterEntry && beforeEntry.mode !== afterEntry.mode) {
      throw new UnsplittableChange(`Git file mode changed for ${path}`);
    }

    // A generated file is read for what changed in it: whole, one API schema is three quarters of a packet.
    if (generated.has(path)) {
      const diff = decoder.decode(
        await git([
          "diff",
          "--no-ext-diff",
          "--no-color",
          mergeBase,
          head,
          "--",
          ":(literal)" + path,
        ]),
      );

      totalBytes += Buffer.byteLength(diff);
      enforceEvidenceLimit(totalBytes);
      files.push({
        path,
        role: "code",
        generated: true,
        before: null,
        after: null,
        diff,
      });

      return;
    }
    const before = await source(path, beforeEntry);
    const after =
      beforeEntry?.hash === afterEntry?.hash &&
      beforeEntry?.mode === afterEntry?.mode
        ? before
        : await source(path, afterEntry);
    const role = isTestFile(path) || testDirectory.test(path) ? "test" : "code";

    if (
      role === "code" &&
      [before, after].some(
        (body) =>
          body &&
          (isTestFile(path, body) ||
            (path.endsWith(".rs") && /#\[cfg\(test\)\]/.test(body)) ||
            (/\.[cm]?[jt]sx?$/.test(path) &&
              /\bimport\.meta\.vitest\b/.test(body))),
      )
    ) {
      throw new UnsplittableChange(
        `Mixed code and inline tests require separately filtered evidence in ${path}`,
      );
    }
    totalBytes +=
      Buffer.byteLength(before ?? "") +
      (before === after ? 0 : Buffer.byteLength(after ?? ""));

    enforceEvidenceLimit(totalBytes);
    files.push({
      path,
      role,
      before,
      after,
      ...(paths.has(path) && !subject.has(path) ? { context: true } : {}),
    });
  }

  for (const path of [...paths].sort()) {
    await addFile(path);
  }
  const fixtures = new Set(
    files
      .filter(({ role }) => role === "test")
      .flatMap((file) => [...pathsUsedByTests(file, [beforeTree, afterTree])]),
  );

  for (const path of [...fixtures].filter((path) => !paths.has(path)).sort()) {
    await addFile(path);
  }

  if (files.length === 0) {
    throw new UnsplittableChange("The change has no code or test file");
  }

  return {
    base,
    head,
    mergeBase,
    files,
    terms: [...new Set([...stems, ...otherStems, ...configKeys])],
  };
}

try {
  const { values } = parseArgs({
    options: {
      base: { type: "string" },
      head: { type: "string" },
      "github-merge-base": { type: "string" },
      scope: { type: "string", multiple: true, default: [] },
      include: { type: "string", multiple: true, default: [] },
    },
  });

  console.log(
    JSON.stringify(
      await capture(
        values.base,
        values.head,
        values.include,
        values["github-merge-base"],
        values.scope,
      ),
    ),
  );
} catch (error) {
  const status =
    error instanceof UnsplittableChange ? "whole_diff" : "incomplete";

  console.log(JSON.stringify({ status, reason: error.message }));
  process.exitCode = 1;
}
