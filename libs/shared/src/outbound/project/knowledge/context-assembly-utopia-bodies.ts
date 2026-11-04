// The lines a coupling item cites, read from the repository (specs/utopia-graph-mirror FR13.8b): Utopia holds the link from a statement to its test and from a test to the lines it covers, never the code itself, so the item is finished with those lines from the repository's own files.

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
  const lines = (await files(span.path))?.split("\n") ?? [];
  const end = Math.min(span.end ?? span.start + MAX_LINES - 1, lines.length);

  if (end < span.start) {
    return null;
  }

  return [
    `  --- ${span.path}:${span.start}-${end}`,
    ...lines.slice(span.start - 1, end).map((line) => `  ${line}`),
  ].join("\n");
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
