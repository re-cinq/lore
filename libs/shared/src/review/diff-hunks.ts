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

    if (line.startsWith("diff --git")) {
      path = null;
      continue;
    }

    if (line.startsWith("--- ")) {
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
