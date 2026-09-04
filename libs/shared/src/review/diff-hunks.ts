/** Which (path, line) positions a PR review may attach an inline comment to: GitHub 422s the WHOLE review if any comment targets a line outside a diff hunk, so the poster must know in advance which lines qualify (right = new-file line on `+`/context, left = old-file line on `-`/context). */

export interface CommentablePositions {
  right: Map<string, Set<number>>;
  left: Map<string, Set<number>>;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function add(map: Map<string, Set<number>>, path: string, line: number): void {
  let set = map.get(path);

  if (!set) {
    set = new Set<number>();
    map.set(path, set);
  }
  set.add(line);
}

interface DiffScanState {
  right: Map<string, Set<number>>;
  left: Map<string, Set<number>>;
  path: string | null;
  newLine: number;
  oldLine: number;
}

/** A line-type handler: applies its effect and returns true when it recognized the line, else false so the next handler is tried. */
type DiffLineHandler = (state: DiffScanState, line: string) => boolean;

const handleFileHeader: DiffLineHandler = (state, line) => {
  if (!line.startsWith("+++ ")) {
    return false;
  }
  const target = line.slice(4).replace(/\t.*$/, "").replace(/^b\//, "");

  state.path = target === "/dev/null" ? null : target;

  return true;
};

const handleDiffHeader: DiffLineHandler = (state, line) => {
  if (!line.startsWith("diff --git")) {
    return false;
  }
  state.path = null;

  return true;
};

const handleOldFileHeader: DiffLineHandler = (_state, line) =>
  line.startsWith("--- ");

const handleHunkHeader: DiffLineHandler = (state, line) => {
  const hunk = line.match(HUNK);

  if (!hunk) {
    return false;
  }
  state.oldLine = Number(hunk[1]);
  state.newLine = Number(hunk[2]);

  return true;
};

const handleUncommentableLine: DiffLineHandler = (state, line) =>
  state.path === null || line.startsWith("\\");

const handleAddedLine: DiffLineHandler = (state, line) => {
  if (!line.startsWith("+")) {
    return false;
  }
  add(state.right, state.path as string, state.newLine++);

  return true;
};

const handleRemovedLine: DiffLineHandler = (state, line) => {
  if (!line.startsWith("-")) {
    return false;
  }
  add(state.left, state.path as string, state.oldLine++);

  return true;
};

const handleContextLine: DiffLineHandler = (state, line) => {
  if (!line.startsWith(" ")) {
    return false;
  }
  add(state.right, state.path as string, state.newLine++);
  add(state.left, state.path as string, state.oldLine++);

  return true;
};

const DIFF_LINE_HANDLERS: DiffLineHandler[] = [
  handleFileHeader,
  handleDiffHeader,
  handleOldFileHeader,
  handleHunkHeader,
  handleUncommentableLine,
  handleAddedLine,
  handleRemovedLine,
  handleContextLine,
];

function applyDiffLine(state: DiffScanState, line: string): void {
  for (const handler of DIFF_LINE_HANDLERS) {
    if (handler(state, line)) {
      return;
    }
  }
}

export function commentablePositions(diff: string): CommentablePositions {
  const state: DiffScanState = {
    right: new Map(),
    left: new Map(),
    path: null,
    newLine: 0,
    oldLine: 0,
  };

  for (const line of diff.split("\n")) {
    applyDiffLine(state, line);
  }

  return { right: state.right, left: state.left };
}

export function isCommentable(
  positions: CommentablePositions,
  path: string,
  line: number,
  side?: "LEFT" | "RIGHT",
): boolean {
  const map = side === "LEFT" ? positions.left : positions.right;

  return map.get(path)?.has(line) ?? false;
}
