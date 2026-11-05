// The part of an opened file worth handing to the write-up: the whole of a short file, else the lines around the task's words, so a 15,000-character file does not reach the model for one function.

const WHOLE_FILE_CHARS = 4_000;
const WINDOW_LINES = 20;
const MIN_WORD = 4;
const GAP = "…";

export function relevantSlice(
  content: string,
  words: string[],
  maxChars: number,
): string {
  if (content.length <= WHOLE_FILE_CHARS) {
    return content;
  }
  const lines = content.split("\n");
  const kept = keptLines(lines, matchingWords(words));
  const sliced =
    kept.size === 0 ? content : joinedWindows(lines, kept, maxChars);

  return sliced.slice(0, maxChars);
}

/** The numbered lines `radius` either side of a 1-based line. */
export function linesAround(
  content: string,
  line: number,
  radius: number,
): string {
  const first = Math.max(0, line - 1 - radius);

  return content
    .split("\n")
    .slice(first, line + radius)
    .map((text, offset) => `${first + offset + 1}: ${text}`)
    .join("\n");
}

function matchingWords(words: string[]): string[] {
  return [
    ...new Set(
      words
        .map((word) => word.toLowerCase())
        .filter((word) => word.length >= MIN_WORD),
    ),
  ];
}

function keptLines(lines: string[], words: string[]): Set<number> {
  const kept = new Set<number>();

  lines.forEach((line, index) => {
    const lowered = line.toLowerCase();

    if (!words.some((word) => lowered.includes(word))) {
      return;
    }

    for (
      let near = index - WINDOW_LINES;
      near <= index + WINDOW_LINES;
      near++
    ) {
      kept.add(near);
    }
  });

  return kept;
}

/** The kept lines in order, numbered, a gap marker before each run, stopping once the budget is spent. */
function joinedWindows(
  lines: string[],
  kept: Set<number>,
  maxChars: number,
): string {
  const indexes = [...kept]
    .filter((index) => index >= 0 && index < lines.length)
    .sort((a, b) => a - b);
  const parts: string[] = [];
  let size = 0;

  for (const position of indexes.keys()) {
    if (size >= maxChars) {
      break;
    }
    parts.push(...numberedLine(lines, indexes, position));
    size += parts[parts.length - 1].length + 1;
  }

  return parts.join("\n");
}

/** The line at `position`, numbered, behind a gap marker when the one before it is not its neighbour. */
function numberedLine(
  lines: string[],
  indexes: number[],
  position: number,
): string[] {
  const index = indexes[position];
  const gap = position === 0 || indexes[position - 1] !== index - 1;

  return [...(gap ? [GAP] : []), `${index + 1}: ${lines[index]}`];
}
