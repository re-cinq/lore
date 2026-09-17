#!/usr/bin/env node
// Re-anchors every `([validated by <title>](path/to/test.ts#Lnn))` link in specs/ and adrs/ whose test moved. Deterministic, no LLM, exit 0 always: a link whose label names the test's title is moved to that `it()`'s current line; a link whose label is the `file.test.ts:NN` form (or whose title matches nothing) is mapped through `git diff` hunks from the merge base, read from the merge-base copy of the markdown so a second run changes nothing. Scoped to the test files this branch changed against the merge base (`--all` sweeps every link, for a deliberate cleanup), so a pull request never carries unrelated spec churn. Runs as the last step of `npm run format`, so the CI `format` job commits the healed anchors back to the branch; a pod runs it after the formatter (specs/implementation-loop FR14).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, posix } from "node:path";

export const LINK = /\[([^\]]*)\]\(([^)#\s]+)#L(\d+)\)/g;
/** `it("…")` / `test('…')` / `it.skip(`…`)` at the start of a line; group 2 is the title (same rule as libs/shared resolve-test-lines). */
export const DECLARATION =
  /^\s*(?:it|test)(?:\.(?:only|skip|todo|concurrent|sequential|fails))?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/;
const TEST_PATH = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const BASENAME_LABEL = /^`?([^`\s/]+\.(?:test|spec)\.[cm]?[jt]sx?):(\d+)`?$/;
const LABEL_PREFIX = /^(?:validated|implemented) by\s+/;

export function isTestPath(path) {
  return TEST_PATH.test(path);
}

/** Every `it`/`test` declaration in a source file, with its 1-based line. */
export function findDeclarations(content) {
  const declarations = [];

  content.split("\n").forEach((line, index) => {
    const match = DECLARATION.exec(line);

    if (match) {
      declarations.push({ name: unescape(match[2]), line: index + 1 });
    }
  });

  return declarations;
}

function unescape(title) {
  return title.replace(/\\(.)/g, "$1");
}

function normalizeTitle(title) {
  return title.replace(/\s+/g, " ").trim();
}

/** The test title a link label names, or null for the `file.test.ts:NN` form and for an empty label. */
export function titleOf(label) {
  const bare = label.replace(LABEL_PREFIX, "").trim();

  if (bare.length === 0 || BASENAME_LABEL.test(bare)) {
    return null;
  }
  const unquoted = bare.replace(/^`(.*)`$/s, "$1");

  return normalizeTitle(unquoted);
}

/** Where a link's path may point: relative to the markdown file, or to the repo root (specs mix both styles). */
export function candidatePaths(linkPath, mdPath) {
  const root = posix.normalize(
    linkPath.replace(/^(?:\.\.?\/)+/, "").replace(/^\//, ""),
  );

  if (linkPath.startsWith("../") || linkPath.startsWith("./")) {
    return [posix.normalize(posix.join(posix.dirname(mdPath), linkPath)), root];
  }

  return [root];
}

/** `@@ -a,b +c,d @@` headers of a `git diff -U0` as {oldStart, oldCount, newStart, newCount}. */
export function parseHunks(diffText) {
  const hunks = [];

  for (const match of diffText.matchAll(
    /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm,
  )) {
    hunks.push({
      oldStart: Number(match[1]),
      oldCount: match[2] === undefined ? 1 : Number(match[2]),
      newStart: Number(match[3]),
      newCount: match[4] === undefined ? 1 : Number(match[4]),
    });
  }

  return hunks;
}

/** A base-version line's line in the working copy, or null when the hunks replaced or removed it. */
export function mapLine(line, hunks) {
  let shift = 0;

  for (const hunk of hunks) {
    if (hunk.oldCount === 0) {
      if (line <= hunk.oldStart) {
        return line + shift;
      }
      shift += hunk.newCount;
      continue;
    }

    if (line < hunk.oldStart) {
      return line + shift;
    }

    if (line < hunk.oldStart + hunk.oldCount) {
      return null;
    }
    shift += hunk.newCount - hunk.oldCount;
  }

  return line + shift;
}

/** Links to test files in document order, one entry per `#Lnn` link: {label, linkPath, line, start, end}. */
export function testLinks(markdown, mdPath) {
  const links = [];

  for (const match of markdown.matchAll(LINK)) {
    const [whole, label, linkPath, line] = match;

    if (!isTestPath(linkPath)) {
      continue;
    }
    links.push({
      label,
      linkPath,
      line: Number(line),
      start: match.index,
      end: match.index + whole.length,
      candidates: candidatePaths(linkPath, mdPath),
    });
  }

  return links;
}

/** The declaration a title names when exactly one does; `duplicates` when several, null when none. */
function declarationFor(title, declarations) {
  const matches = declarations.filter(
    (declaration) => normalizeTitle(declaration.name) === title,
  );

  if (matches.length === 1) {
    return matches[0];
  }

  return matches.length > 1 ? "duplicates" : null;
}

function spanOf(declaration, declarations, lastLine) {
  const index = declarations.indexOf(declaration);
  const next = declarations[index + 1];

  return { start: declaration.line, end: next ? next.line - 1 : lastLine };
}

/** Re-anchors one markdown file. `target(candidates)` → {path, content} | null; `inScope(path)` (optional) → whether that test file is one this branch touched; `baseLinks(mdPath, path)` → the base copy's links to that path in document order as {label, line} (or null when the base has no copy); `hunksFor(path)` → parsed hunks base→working copy. */
export function reanchorMarkdown(markdown, mdPath, io) {
  const links = testLinks(markdown, mdPath);
  const changes = [];
  const unmapped = [];
  const byPath = new Map();

  for (const link of links) {
    const key = link.candidates[0];

    byPath.set(key, [...(byPath.get(key) ?? []), link]);
  }
  const edits = [];

  for (const [, group] of byPath) {
    if (io.inScope && !group[0].candidates.some(io.inScope)) {
      continue;
    }
    const target = io.target(group[0].candidates);

    if (!target) {
      group.forEach((link) =>
        unmapped.push({ ...link, reason: "target file not found" }),
      );
      continue;
    }
    const declarations = findDeclarations(target.content);
    const lastLine = target.content.split("\n").length;
    const base = io.baseLinks(mdPath, target.path) ?? [];
    const hunks = io.hunksFor(target.path);
    const ordinals = ordinalsOf(group);
    const occurrences = occurrencesOf(group);

    group.forEach((link, index) => {
      const resolved = resolveLink(link, {
        declarations,
        lastLine,
        baseLine: baseLineFor(link, base, {
          ordinal: ordinals[index],
          occurrence: occurrences[index],
          kindCount: ordinals.filter((ordinal) => ordinal >= 0).length,
        }),
        hunks,
      });

      if (resolved.reason) {
        unmapped.push({ ...link, reason: resolved.reason });
      } else if (resolved.line !== link.line) {
        edits.push({ link, line: resolved.line });
        changes.push({
          label: link.label,
          path: target.path,
          from: link.line,
          to: resolved.line,
        });
      }
    });
  }

  return { content: applyEdits(markdown, edits), changes, unmapped };
}

/** The ordinal of each `file.test.ts:NN`-form link among its kind in the group, or -1 for a titled or prose label. */
function ordinalsOf(group) {
  let seen = 0;

  return group.map((link) =>
    BASENAME_LABEL.test(stripPrefix(link.label)) ? seen++ : -1,
  );
}

/** Which occurrence of its own label each link is within the group: 0 for the first `y.test.ts:7`, 1 for the second. */
function occurrencesOf(group) {
  const seen = new Map();

  return group.map((link) => {
    const occurrence = seen.get(link.label) ?? 0;

    seen.set(link.label, occurrence + 1);

    return occurrence;
  });
}

function stripPrefix(label) {
  return label.replace(LABEL_PREFIX, "").trim();
}

/** The merge-base copy's anchor for this link: the base link carrying the same label — its Nth occurrence when the label repeats, as long as the branch kept every repeat — or, for a `file.test.ts:NN` label the base does not carry, the base link of that kind at the same ordinal. The ordinal is the LAST resort: it counts every link of the kind in the file, so relabelling or removing one link anywhere above hands each later link its neighbour's anchor. Null when the base cannot say. */
function baseLineFor(link, base, { ordinal, occurrence, kindCount }) {
  const sameLabel = base.filter((entry) => entry.label === link.label);

  if (sameLabel.length > occurrence) {
    return sameLabel[occurrence].line;
  }

  if (ordinal < 0 || sameLabel.length > 0) {
    return null;
  }
  const kind = base.filter((entry) =>
    BASENAME_LABEL.test(stripPrefix(entry.label)),
  );

  // An ordinal only pairs two lists of the same length: one link added, removed or relabelled shifts every pairing after it.
  return kind.length === kindCount ? (kind[ordinal]?.line ?? null) : null;
}

function resolveLink(link, ctx) {
  const title = titleOf(link.label);

  if (title !== null) {
    const declaration = declarationFor(title, ctx.declarations);

    if (declaration === "duplicates") {
      return { reason: "several tests carry this title" };
    }

    if (declaration) {
      const span = spanOf(declaration, ctx.declarations, ctx.lastLine);

      return {
        line:
          link.line >= span.start && link.line <= span.end
            ? link.line
            : declaration.line,
      };
    }
  }

  if (ctx.baseLine === null || ctx.baseLine === undefined) {
    return title === null
      ? { reason: "no base copy to map the line from" }
      : {
          reason:
            "no test carries this title and the base copy has no link with this label",
        };
  }
  const mapped = mapLine(ctx.baseLine, ctx.hunks);

  return mapped === null
    ? { reason: "the anchored line was rewritten by the diff" }
    : { line: mapped };
}

/** Rewrites `#Lnn` for each edit, last edit first so offsets stay valid. The LABEL is never touched: it is the key a link is paired with its base copy by, and rewriting `file.test.ts:3` to the new line made it collide with a different link's base label, so the next run paired the two crosswise and they swapped for ever. */
function applyEdits(markdown, edits) {
  let out = markdown;

  for (const { link, line } of [...edits].sort(
    (a, b) => b.link.start - a.link.start,
  )) {
    out = `${out.slice(0, link.start)}[${link.label}](${link.linkPath}#L${line})${out.slice(link.end)}`;
  }

  return out;
}

function markdownFiles(root) {
  const files = [];

  for (const dir of ["specs", "adrs"]) {
    const base = join(root, dir);

    if (!existsSync(base)) {
      continue;
    }

    for (const entry of readdirSync(base, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(
          posix.normalize(
            join(dir, entry.parentPath.slice(base.length + 1) || "", entry.name)
              .split("\\")
              .join("/"),
          ),
        );
      }
    }
  }

  return files.sort();
}

function git(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function mergeBase(root) {
  return (
    (
      git(root, ["merge-base", "origin/main", "HEAD"]) ??
      git(root, ["merge-base", "main", "HEAD"])
    )?.trim() ?? null
  );
}

/** Test files this branch changed against the merge base, committed or not — the only files whose `it()` lines can have moved. */
function changedTestPaths(root, base) {
  const committed = git(root, ["diff", "--name-only", base]) ?? "";
  const untracked =
    git(root, ["ls-files", "--others", "--exclude-standard"]) ?? "";

  return new Set(`${committed}\n${untracked}`.split("\n").filter(isTestPath));
}

function main() {
  const root = process.cwd();
  const sweepAll = process.argv.includes("--all");
  const requested = process.argv.slice(2).filter((arg) => arg !== "--all");
  const files = requested.length > 0 ? requested : markdownFiles(root);
  const base = mergeBase(root);

  if (!base && !sweepAll) {
    console.log(
      "[spec-links] no merge base with main (shallow clone?) — nothing re-anchored; pass --all to sweep every link by test title",
    );

    return;
  }
  const scope = base && !sweepAll ? changedTestPaths(root, base) : null;
  const hunkCache = new Map();
  const io = {
    inScope: scope ? (path) => scope.has(path) : undefined,
    target: (candidates) => {
      const path = candidates.find((candidate) =>
        existsSync(join(root, candidate)),
      );

      return path
        ? { path, content: readFileSync(join(root, path), "utf8") }
        : null;
    },
    baseLinks: (mdPath, targetPath) => {
      if (!base) {
        return null;
      }
      const baseMd = git(root, ["show", `${base}:${mdPath}`]);

      return baseMd === null
        ? null
        : testLinks(baseMd, mdPath)
            .filter((link) => link.candidates.includes(targetPath))
            .map((link) => ({ label: link.label, line: link.line }));
    },
    hunksFor: (targetPath) => {
      if (!base) {
        return [];
      }

      if (!hunkCache.has(targetPath)) {
        hunkCache.set(
          targetPath,
          parseHunks(git(root, ["diff", "-U0", base, "--", targetPath]) ?? ""),
        );
      }

      return hunkCache.get(targetPath);
    },
  };
  let changed = 0;
  let unmappedTotal = 0;

  for (const file of files) {
    const abs = join(root, normalize(file));

    if (!existsSync(abs)) {
      continue;
    }
    const before = readFileSync(abs, "utf8");
    const { content, changes, unmapped } = reanchorMarkdown(before, file, io);

    if (content !== before) {
      writeFileSync(abs, content);
      changed += changes.length;
      changes.forEach((change) =>
        console.log(
          `[spec-links] ${file}: ${change.path}#L${change.from} -> #L${change.to}`,
        ),
      );
    }
    unmapped.forEach((link) =>
      console.log(
        `[spec-links] UNMAPPED ${file}: [${link.label}](${link.linkPath}#L${link.line}) — ${link.reason}`,
      ),
    );
    unmappedTotal += unmapped.length;
  }
  console.log(
    `[spec-links] re-anchored ${changed} link(s), ${unmappedTotal} unmapped${base ? "" : " (no merge base: title mapping only)"}`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  main();
}
