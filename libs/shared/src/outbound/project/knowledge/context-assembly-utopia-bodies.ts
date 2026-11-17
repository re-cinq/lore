// The lines a coupling item cites, read from the repository (specs/utopia-graph-mirror FR13.8b): Utopia holds the link from a statement to its test and from a test to the lines it covers, never the code itself, so the item is finished with those lines from the repository's own files.

import { resolveAnchorLine } from "../../../domain/spec-trace/resolve-anchor-line.js";
import { testDeclarations } from "../../../domain/spec-trace/test-declarations.js";
import type { Span } from "./context-assembly-utopia-coverage-text.js";

/** A file of the repository at its default branch, or null when it has none by that path. */
export type RepoFiles = (path: string) => Promise<string | null>;

const MAX_SPANS = 3;
const MAX_LINES = 40;

/** The item's text followed by the first three cited spans that are in the repository, each led by `--- <path>:<start>-<end>`, a span with no end cut at 40 lines and every span at the file's end; the text as it is when no span can be read. */
export async function withBodies(
  text: string,
  spans: Span[],
  files: RepoFiles,
): Promise<string> {
  const bodies = await Promise.all(
    spans.slice(0, MAX_SPANS).map((span) => bodyOf(span, files)),
  );

  return [text, ...bodies.filter((body) => body !== null)].join("\n");
}

async function bodyOf(span: Span, files: RepoFiles): Promise<string | null> {
  const source = await files(span.path);
  const lines = source?.split("\n") ?? [];
  const { start, end } = boundsOf(span, source, lines.length);

  if (start === null || end < start) {
    return null;
  }

  return [
    `  --- ${span.path}:${start}-${end}`,
    ...lines.slice(start - 1, end).map((line) => `  ${line}`),
  ].join("\n");
}

/** The span's first and last line in a file of `length` lines: 40 lines when no end is known, never past the file's end. */
function boundsOf(
  span: Span,
  source: string | null,
  length: number,
): { start: number | null; end: number } {
  const { start, end } =
    span.anchorHash === undefined
      ? span
      : anchoredBounds(span.anchorHash, source);

  return { start, end: Math.min(end ?? (start ?? 0) + MAX_LINES - 1, length) };
}

/** A test named by anchor hash alone: from the line carrying the hash to the line before the next test declared in the file, at most 40 lines. */
function anchoredBounds(
  hash: string,
  source: string | null,
): { start: number | null; end: number | null } {
  const start = resolveAnchorLine({ line: null, hash }, source);
  const next = testDeclarations(source ?? "").find(
    (declaration) => start !== null && declaration.line > start,
  );

  return {
    start,
    end:
      start === null
        ? null
        : Math.min((next?.line ?? Infinity) - 1, start + MAX_LINES - 1),
  };
}

/** Each file read once however many items cite it. */
export function memoizedFiles(files: RepoFiles): RepoFiles {
  const reads = new Map<string, Promise<string | null>>();

  return (path) => {
    const started = reads.get(path) ?? files(path).catch(() => null);

    reads.set(path, started);

    return started;
  };
}
