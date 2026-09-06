/** Spec-anchor rot check at ready flip (#1747): verify #Lnn links in touched statements; post rot as PR comment (visibility only). */

// posix explicitly: these are GitHub API paths, forward-slash on every OS.
import { dirname, normalize } from "node:path/posix";

export interface RottenAnchor {
  specPath: string;
  target: string;
  line: number;
  reason: "missing file" | "line out of range" | "blank line" | "comment line";
}

const ANCHOR = /\]\(([^)#\s]+)#L(\d+)\)/g;
const CODE_COMMENT = /^(\/\/|\/\*|\*)/;

function commentReason(target: string, trimmed: string): boolean {
  if (/\.(ts|tsx|js|mjs|cjs)$/.test(target)) {
    return CODE_COMMENT.test(trimmed);
  }

  if (/\.(yml|yaml)$/.test(target)) {
    return trimmed.startsWith("#");
  }

  return false;
}

/** Anchor target path: doc-relative or root-relative (null if neither resolves). */
function targetCandidates(specPath: string, target: string): string[] {
  return [
    normalize(`${dirname(specPath)}/${target}`),
    normalize(target),
  ].filter((candidate) => !candidate.startsWith(".."));
}

/** First candidate path, or the raw target when nothing resolves relative-safe. */
function firstTargetCandidate(specPath: string, target: string): string {
  return targetCandidates(specPath, target)[0] ?? target;
}

function resolveTarget(
  specPath: string,
  target: string,
  readLines: (path: string) => string[] | null,
): { path: string; lines: string[] } | null {
  for (const candidate of targetCandidates(specPath, target)) {
    const lines = readLines(candidate);

    if (lines !== null) {
      return { path: candidate, lines };
    }
  }

  return null;
}

/** The 1-based line, or undefined when out of range — `.at()` would wrap on #L0. */
function lineAt(lines: string[], line: number): string | undefined {
  return line >= 1 ? lines.at(line - 1) : undefined;
}

/** Classifies one `#Lnn` match, or null if it resolves cleanly. */
function anchorAt(
  specPath: string,
  target: string,
  line: number,
  readLines: (path: string) => string[] | null,
): RottenAnchor | null {
  if (/^[a-z]+:\/\//.test(target)) {
    return null;
  }
  const resolved = resolveTarget(specPath, target, readLines);

  if (!resolved) {
    return {
      specPath,
      target: firstTargetCandidate(specPath, target),
      line,
      reason: "missing file",
    };
  }
  const targetLine = lineAt(resolved.lines, line);

  if (targetLine === undefined) {
    return {
      specPath,
      target: resolved.path,
      line,
      reason: "line out of range",
    };
  }
  const trimmed = targetLine.trim();

  if (trimmed.length === 0) {
    return { specPath, target: resolved.path, line, reason: "blank line" };
  }

  if (commentReason(resolved.path, trimmed)) {
    return { specPath, target: resolved.path, line, reason: "comment line" };
  }

  return null;
}

function rottenAnchorsInSpec(
  spec: { path: string; content: string },
  readLines: (path: string) => string[] | null,
): RottenAnchor[] {
  const rotten: RottenAnchor[] = [];

  for (const match of spec.content.matchAll(ANCHOR)) {
    const target = match[1];
    const line = parseInt(match[2], 10);
    const anchor = anchorAt(spec.path, target, line, readLines);

    if (anchor) {
      rotten.push(anchor);
    }
  }

  return rotten;
}

export function findRottenAnchors(
  specs: Array<{ path: string; content: string }>,
  readLines: (path: string) => string[] | null,
): RottenAnchor[] {
  return specs.flatMap((spec) => rottenAnchorsInSpec(spec, readLines));
}

function linesOf(content: string | null): string[] | null {
  return content?.split(/\r?\n/) ?? null;
}

export interface RottenAnchorReportInput {
  prNumber: number;
  branch: string;
  pulls: { listFiles(number: number): Promise<string[]> };
  repo: { read(path: string, ref?: string): Promise<string | null> };
}

/** PR comment body listing rotten anchors, or null if markdown clean. */
export async function rottenAnchorReport(
  input: RottenAnchorReportInput,
): Promise<string | null> {
  const changed = (await input.pulls.listFiles(input.prNumber)).filter((f) =>
    f.endsWith(".md"),
  );

  if (changed.length === 0) {
    return null;
  }
  const specs: Array<{ path: string; content: string }> = [];

  for (const path of changed) {
    const content = await input.repo.read(path, input.branch);

    if (content !== null) {
      specs.push({ path, content });
    }
  }
  const cache = new Map<string, string[] | null>();
  const readLines = (path: string): string[] | null => {
    if (!cache.has(path)) {
      cache.set(path, null);
    }

    return cache.get(path) ?? null;
  };

  // Pre-fetch every candidate target so findRottenAnchors stays synchronous.
  const candidates = new Set(
    specs.flatMap((spec) =>
      [...spec.content.matchAll(ANCHOR)]
        .map((match) => match[1])
        .filter((target) => !/^[a-z]+:\/\//.test(target))
        .flatMap((target) => targetCandidates(spec.path, target)),
    ),
  );

  for (const candidate of candidates) {
    const content = await input.repo.read(candidate, input.branch);

    cache.set(candidate, linesOf(content));
  }
  const rotten = findRottenAnchors(specs, readLines);

  if (rotten.length === 0) {
    return null;
  }
  const bullets = rotten.map(
    (r) => `- \`${r.specPath}\` → \`${r.target}#L${r.line}\` — ${r.reason}`,
  );

  return [
    "**Spec anchors landing nowhere** (deterministic check at the ready flip)",
    "",
    "These `#Lnn` links in this branch's changed markdown do not resolve to a",
    "citable line on the branch head. A link onto a blank or comment line is a",
    "broken claim — repoint it at the assertion it validates.",
    "",
    ...bullets,
  ].join("\n");
}
