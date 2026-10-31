// What a reader of a mirrored document needs to know before trusting it: whether it is in force and when it was last amended.

export interface DocMarks {
  status: string | null;
  amended: string | null;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const SPEC_ROW = /^\|\s*Status\s*\|\s*([^|\n]*?)\s*\|/im;
const BOLD_LINE = /^[-*]\s*\*\*Status\*\*\s*:\s*(.+)$/im;
const PLAIN_LINE = /^Status\s*:\s*(.+)$/im;
const STATUS_SECTION = /^##\s+Status\s*\n+([^\n]+)/im;
const AMENDMENT_HEADING = /^#{1,6}\s+Amendment[^\n]*?(\d{4}-\d{2}-\d{2})/gim;
const DATED_MARKER = /\*\((?:added\s+)?(\d{4}-\d{2}-\d{2})[^)]*\)\*/g;

export function docMarks(content: string): DocMarks {
  return { status: statusOf(content), amended: newestAmendment(content) };
}

function statusOf(content: string): string | null {
  const frontmatter = content.match(FRONTMATTER)?.[1] ?? "";
  const framed = frontmatterStatus(frontmatter);
  const found =
    framed ??
    [SPEC_ROW, BOLD_LINE, PLAIN_LINE, STATUS_SECTION]
      .map((pattern) => content.match(pattern)?.[1])
      .find((value) => value !== undefined);

  return found ? lowerFirstWord(clean(found)) : null;
}

function frontmatterStatus(frontmatter: string): string | null {
  const status = frontmatter.match(/^status\s*:\s*(.+?)\s*$/im)?.[1];
  const successor = frontmatter.match(/^superseded_by\s*:\s*(\d+)/im)?.[1];

  if (!status) {
    return null;
  }

  return successor && /^superseded$/i.test(clean(status))
    ? `superseded by ADR-${successor.padStart(3, "0")}`
    : status;
}

function clean(value: string): string {
  return value
    .replace(/\*\*|`/g, "")
    .replace(/["']/g, "")
    .trim();
}

function lowerFirstWord(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function newestAmendment(content: string): string | null {
  const dates = [AMENDMENT_HEADING, DATED_MARKER].flatMap((pattern) =>
    [...content.matchAll(pattern)].map((match) => match[1]),
  );

  return dates.length ? dates.sort().at(-1)! : null;
}

export function markLines(marks: DocMarks): string[] {
  return [
    ...(marks.status ? [`Status: ${marks.status}`] : []),
    ...(marks.amended ? [`Amended: ${marks.amended}`] : []),
  ];
}
