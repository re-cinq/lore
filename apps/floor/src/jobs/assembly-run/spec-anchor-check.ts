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

function rottenAnchorsInSpec(
  spec: { path: string; content: string },
  readLines: (path: string) => string[] | null,
): RottenAnchor[] {
  const rotten: RottenAnchor[] = [];

  for (const match of spec.content.matchAll(ANCHOR)) {
    const target = match[1];
    const line = parseInt(match[2], 10);

    if (/^[a-z]+:\/\//.test(target)) {
      continue;
    }
    const resolved = resolveTarget(spec.path, target, readLines);

    if (!resolved) {
      rotten.push({
        specPath: spec.path,
        target: targetCandidates(spec.path, target)[0] ?? target,
        line,
        reason: "missing file",
      });
      continue;
    }
    const targetLine = resolved.lines[line - 1];

    if (targetLine === undefined) {
      rotten.push({
        specPath: spec.path,
        target: resolved.path,
        line,
        reason: "line out of range",
      });
      continue;
    }
    const trimmed = targetLine.trim();

    if (trimmed.length === 0) {
      rotten.push({
        specPath: spec.path,
        target: resolved.path,
        line,
        reason: "blank line",
      });
      continue;
    }

    if (commentReason(resolved.path, trimmed)) {
      rotten.push({
        specPath: spec.path,
        target: resolved.path,
        line,
        reason: "comment line",
      });
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

    cache.set(candidate, content?.split(/\r?\n/) ?? null);
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
