/**
 * Which (path, line) positions a PR review may attach an inline comment to.
 * GitHub's review API rejects the WHOLE atomic review with a 422 if any one
 * inline comment targets a line that is not inside a diff hunk — so the poster
 * must know, before it posts, exactly which lines are commentable.
 *
 * A unified diff makes a line commentable when it appears inside a hunk:
 * added (`+`) and context (` `) lines carry a RIGHT-side (new file) line number;
 * removed (`-`) and context lines carry a LEFT-side (old file) line number.
 */

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

export function commentablePositions(diff: string): CommentablePositions {
  const right = new Map<string, Set<number>>();
  const left = new Map<string, Set<number>>();
  let path: string | null = null;
  let newLine = 0;
  let oldLine = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).replace(/\t.*$/, "").replace(/^b\//, "");

      path = target === "/dev/null" ? null : target;
      continue;
    }

    if (line.startsWith("--- ") || line.startsWith("diff --git")) {
      if (line.startsWith("diff --git")) {
        path = null;
      }
      continue;
    }
    const hunk = line.match(HUNK);

    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }

    if (path === null || line.startsWith("\\")) {
      continue;
    }

    if (line.startsWith("+")) {
      add(right, path, newLine++);
      continue;
    }

    if (line.startsWith("-")) {
      add(left, path, oldLine++);
      continue;
    }

    if (line.startsWith(" ")) {
      add(right, path, newLine++);
      add(left, path, oldLine++);
    }
  }

  return { right, left };
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
