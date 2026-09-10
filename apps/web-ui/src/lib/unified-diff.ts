/** Parses one GitHub `patch` string (a unified diff without the file header) into numbered lines for a side-annotated diff view. No diff library: the run page needs only line kinds and numbers, which the hunk header already states. */

export type DiffLineKind = "hunk" | "add" | "del" | "ctx";

export interface DiffLine {
  kind: DiffLineKind;
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export interface DiffStats {
  added: number;
  removed: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const NO_NEWLINE_MARKER = "\\ No newline at end of file";

interface Cursor {
  oldNo: number;
  newNo: number;
}

/** Numbered lines of a unified patch; the no-newline marker survives as an unnumbered context line, an empty or absent patch yields no lines. */
export function parseUnifiedPatch(
  patch: string | null | undefined,
): DiffLine[] {
  if (!patch) {
    return [];
  }
  const cursor: Cursor = { oldNo: 0, newNo: 0 };

  return patch
    .split("\n")
    .map((raw) => hunkLine(raw, cursor) ?? bodyLine(raw, cursor));
}

function hunkLine(raw: string, cursor: Cursor): DiffLine | null {
  const header = HUNK_HEADER.exec(raw);

  if (!header) {
    return null;
  }
  cursor.oldNo = Number(header[1]);
  cursor.newNo = Number(header[2]);

  return { kind: "hunk", oldNo: null, newNo: null, text: raw };
}

function bodyLine(raw: string, cursor: Cursor): DiffLine {
  const text = raw.slice(1);

  if (raw.startsWith("+")) {
    return { kind: "add", oldNo: null, newNo: cursor.newNo++, text };
  }

  if (raw.startsWith("-")) {
    return { kind: "del", oldNo: cursor.oldNo++, newNo: null, text };
  }

  if (raw === NO_NEWLINE_MARKER) {
    return { kind: "ctx", oldNo: null, newNo: null, text: raw };
  }

  return { kind: "ctx", oldNo: cursor.oldNo++, newNo: cursor.newNo++, text };
}

export function diffStats(lines: DiffLine[]): DiffStats {
  return {
    added: lines.filter((line) => line.kind === "add").length,
    removed: lines.filter((line) => line.kind === "del").length,
  };
}
