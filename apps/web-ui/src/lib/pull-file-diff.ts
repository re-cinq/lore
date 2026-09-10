// Pure: pairs a heatmap path with the PR's changed file and shapes it for the diff view (specs/assembly-line-run-viz FR8.5).
import type { PullFileChange } from "@/lib/api/pull-files";
import { stripWorkspacePrefix } from "@/lib/file-heatmap";
import {
  diffStats,
  parseUnifiedPatch,
  type DiffLine,
  type DiffStats,
} from "@/lib/unified-diff";

export type DiffViewModel =
  | { kind: "absent" }
  | { kind: "binary"; file: PullFileChange }
  | { kind: "diff"; file: PullFileChange; lines: DiffLine[]; stats: DiffStats };

/** The changed file a touched path names: exact, then with the sandbox prefix dropped, then by a shared tail — a heatmap path may be absolute while GitHub's is repo-relative. */
export function matchChangedFile(
  files: readonly PullFileChange[],
  touchedPath: string,
): PullFileChange | null {
  const stripped = stripWorkspacePrefix(touchedPath);
  const candidates = [
    (file: PullFileChange) => file.filename === touchedPath,
    (file: PullFileChange) => file.filename === stripped,
    (file: PullFileChange) => endsWithEither(file.filename, stripped),
  ];

  for (const matches of candidates) {
    const found = files.find(matches);

    if (found) {
      return found;
    }
  }

  return null;
}

function endsWithEither(a: string, b: string): boolean {
  return a.endsWith(b) || b.endsWith(a);
}

/** What the diff view renders: nothing to show, a file GitHub gave no patch for, or the parsed lines with their tally. */
export function diffViewModel(file: PullFileChange | null): DiffViewModel {
  if (file === null) {
    return { kind: "absent" };
  }

  if (file.patch === null) {
    return { kind: "binary", file };
  }
  const lines = parseUnifiedPatch(file.patch);

  return { kind: "diff", file, lines, stats: diffStats(lines) };
}
