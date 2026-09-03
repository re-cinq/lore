/** Deterministic spec segmentation; must agree with rehype highlighter on (ordinal, text, kind). */

export type StatementKind = "sentence" | "list-item";
export type Testability = "testable" | "untestable";
export type UntestableCategory =
  | "intro"
  | "vision"
  | "background"
  | "clarification"
  | "open-question"
  | "limitation"
  | "rationale";

export interface Statement {
  ordinal: number;
  text: string;
  kind: StatementKind;
  enclosingHeading: string | null;
  /** 1-based source line; optional for hand-built doubles in tests. */
  line?: number;
}

export interface Classification {
  testability: Testability;
  category: UntestableCategory | null;
  matchedBySection: boolean;
}

const ABBREVIATIONS = new Set([
  "e.g",
  "i.e",
  "etc",
  "vs",
  "Mr",
  "Mrs",
  "Ms",
  "Dr",
  "Sr",
  "Jr",
  "St",
  "Prof",
  "Inc",
  "Co",
  "Ltd",
  "approx",
  "cf",
  "viz",
  "no",
  "v1",
  "v2",
  "v3",
  "v4",
]);

/** Trailing markdown link parenthetical belongs to previous sentence (spec-link-parser.ts). */
const TRAILING_LINK_PARENTHETICAL = /^\(\[[^\]]*\]\(/;

function isListItem(line: string): boolean {
  return /^\s*(?:[-*+]\s+|\d+\.\s+)/.test(line);
}

function stripListMarker(line: string): string {
  return line.replace(/^\s*(?:[-*+]\s+|\d+\.\s+)/, "").trim();
}

function isHeading(line: string): boolean {
  return /^#{1,6}\s+\S/.test(line);
}

function parseHeading(line: string): string {
  return line.replace(/^#{1,6}\s+/, "").trim();
}

function isTableRow(line: string): boolean {
  const t = line.trim();

  return t.startsWith("|") && t.endsWith("|") && t.length >= 2;
}

function indexOfNextNonSpace(text: string, from: number): number {
  let index = from;

  while (index < text.length && text[index] === " ") {
    index++;
  }

  return index;
}

function pushTrimmedNonEmpty(out: string[], text: string): void {
  const trimmed = text.trim();

  if (trimmed) {
    out.push(trimmed);
  }
}

function endsInAbbreviationOrInitial(buf: string): boolean {
  const trimmed = buf.trimEnd().replace(/[.?!]+$/, "");
  const lastWord = trimmed.split(/\s+/).pop() || "";

  if (ABBREVIATIONS.has(lastWord)) {
    return true;
  }

  return /^[A-Z]$/.test(lastWord);
}

function splitSentences(text: string): string[] {
  const flat = text.replace(/\s+/g, " ").trim();

  if (!flat) {
    return [];
  }

  const out: string[] = [];
  let buf = "";

  for (let i = 0; i < flat.length; i++) {
    buf += flat[i];
    const ch = flat[i];

    if (ch !== "." && ch !== "?" && ch !== "!") {
      continue;
    }

    const j = indexOfNextNonSpace(flat, i + 1);

    if (j >= flat.length) {
      pushTrimmedNonEmpty(out, buf);
      buf = "";
      break;
    }
    const nextCh = flat[j];

    if (!/[A-Z([0-9]/.test(nextCh)) {
      continue;
    }

    if (TRAILING_LINK_PARENTHETICAL.test(flat.slice(j))) {
      continue;
    }

    if (ch === "." && endsInAbbreviationOrInitial(buf)) {
      continue;
    }

    out.push(buf.trim());
    buf = "";
    i = j - 1;
  }
  pushTrimmedNonEmpty(out, buf);

  return out;
}

function endsListItem(line: string): boolean {
  if (line.trim() === "" || isListItem(line)) {
    return true;
  }

  if (isHeading(line) || isTableRow(line)) {
    return true;
  }

  return /^\s*```/.test(line);
}

function readListItemLines(
  lines: string[],
  startIndex: number,
): { combined: string; endIndex: number } {
  let combined = stripListMarker(lines[startIndex]);
  let index = startIndex;

  while (index + 1 < lines.length && !endsListItem(lines[index + 1])) {
    combined += " " + lines[index + 1].trim();
    index++;
  }

  return { combined: combined.replace(/\s+/g, " ").trim(), endIndex: index };
}

export function segmentStatements(content: string): Statement[] {
  const lines = content.split(/\r?\n/);
  const statements: Statement[] = [];
  let ordinal = 0;
  let currentHeading: string | null = null;
  let inFence = false;
  let paragraphLines: string[] = [];
  let paragraphStartLine = 0;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }
    const para = paragraphLines.join(" ");
    const startLine = paragraphStartLine;

    paragraphLines = [];

    for (const sentence of splitSentences(para)) {
      statements.push({
        ordinal: ordinal++,
        text: sentence,
        kind: "sentence",
        enclosingHeading: currentHeading,
        line: startLine,
      });
    }
  };

  const pushListItemStatement = (text: string, line: number) => {
    if (!text) {
      return;
    }
    statements.push({
      ordinal: ordinal++,
      text,
      kind: "list-item",
      enclosingHeading: currentHeading,
      line,
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*```/.test(line)) {
      flushParagraph();
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    if (isHeading(line)) {
      flushParagraph();
      currentHeading = parseHeading(line);
      continue;
    }

    if (isTableRow(line)) {
      flushParagraph();
      continue;
    }

    if (isListItem(line)) {
      flushParagraph();
      const itemStartLine = i + 1;
      const listItem = readListItemLines(lines, i);

      i = listItem.endIndex;
      pushListItemStatement(listItem.combined, itemStartLine);
      continue;
    }

    if (paragraphLines.length === 0) {
      paragraphStartLine = i + 1;
    }
    paragraphLines.push(line.trim());
  }
  flushParagraph();

  return statements;
}

const SECTION_RULES: { match: RegExp; category: UntestableCategory }[] = [
  { match: /problem\s*statement/i, category: "background" },
  { match: /background/i, category: "background" },
  { match: /context\b/i, category: "background" },
  { match: /research/i, category: "background" },
  { match: /personas?/i, category: "background" },
  { match: /implementation\s*phases?/i, category: "background" },
  { match: /vision/i, category: "vision" },
  {
    match: /goals?\s*[&/]\s*non[-\s]?goals?|non[-\s]?goals?/i,
    category: "vision",
  },
  { match: /clarif/i, category: "clarification" },
  { match: /open\s*questions?/i, category: "open-question" },
  {
    match: /limitations?|known\s*gotchas?|out[-\s]?of[-\s]?scope/i,
    category: "limitation",
  },
  {
    match: /rationale|why\b|alternatives?\s*(considered)?|consequences/i,
    category: "rationale",
  },
];

/** Content rules: Decision/See ADR/See spec always untestable (narrow anchors). */
const CONTENT_RULES: { match: RegExp; category: UntestableCategory }[] = [
  { match: /^\s*\*{0,2}\s*decision\s*\*{0,2}\s*[:—-]/i, category: "rationale" },
  {
    match: /^\s*\(?see\b[^.!?]*\b(adr|spec|section|fr|§)\b/i,
    category: "rationale",
  },
];

/** Build intro ordinals (no heading or first heading). */
export function buildIntroOrdinals(statements: Statement[]): Set<number> {
  const ordinals = new Set<number>();
  let firstHeading: string | null = null;

  for (const s of statements) {
    if (firstHeading === null && s.enclosingHeading !== null) {
      firstHeading = s.enclosingHeading;
      break;
    }
  }

  for (const s of statements) {
    if (s.enclosingHeading === null || s.enclosingHeading === firstHeading) {
      ordinals.add(s.ordinal);
    }
  }

  return ordinals;
}

/** Section-heading heuristic: narrative sections → untestable; else → LLM. */
export function classifyByHeuristic(
  statement: Statement,
  introOrdinals: Set<number>,
): Classification {
  if (introOrdinals.has(statement.ordinal)) {
    return {
      testability: "untestable",
      category: "intro",
      matchedBySection: true,
    };
  }

  for (const { match, category } of CONTENT_RULES) {
    if (match.test(statement.text)) {
      return { testability: "untestable", category, matchedBySection: true };
    }
  }
  const heading = statement.enclosingHeading;

  if (!heading) {
    return { testability: "testable", category: null, matchedBySection: false };
  }

  for (const { match, category } of SECTION_RULES) {
    if (match.test(heading)) {
      return { testability: "untestable", category, matchedBySection: true };
    }
  }

  return { testability: "testable", category: null, matchedBySection: false };
}
