/** Deterministic spec segmentation; must agree with rehype highlighter on (ordinal, text, kind). */

import { splitSentences } from "./spec-sentence-split.js";

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

type StatementLineAction =
  "blank" | "heading" | "table" | "list-item" | "paragraph";

/** Classifies a non-fence, non-blank-checked line by which segmentation action it triggers. */
function classifyStatementLine(line: string): StatementLineAction {
  if (line.trim() === "") {
    return "blank";
  }

  if (isHeading(line)) {
    return "heading";
  }

  if (isTableRow(line)) {
    return "table";
  }

  if (isListItem(line)) {
    return "list-item";
  }

  return "paragraph";
}

type StatementLineHandler = (
  lines: string[],
  i: number,
  line: string,
) => number;

/** Line-by-line statement accumulator behind `segmentStatements`. */
class StatementAccumulator {
  private statements: Statement[] = [];
  private ordinal = 0;
  private currentHeading: string | null = null;
  private inFence = false;
  private paragraphLines: string[] = [];
  private paragraphStartLine = 0;

  private flushParagraph(): void {
    if (this.paragraphLines.length === 0) {
      return;
    }
    const para = this.paragraphLines.join(" ");
    const startLine = this.paragraphStartLine;

    this.paragraphLines = [];

    for (const sentence of splitSentences(para)) {
      this.statements.push({
        ordinal: this.ordinal++,
        text: sentence,
        kind: "sentence",
        enclosingHeading: this.currentHeading,
        line: startLine,
      });
    }
  }

  private pushListItemStatement(text: string, line: number): void {
    if (!text) {
      return;
    }
    this.statements.push({
      ordinal: this.ordinal++,
      text,
      kind: "list-item",
      enclosingHeading: this.currentHeading,
      line,
    });
  }

  private appendParagraphLine(line: string, lineNumber: number): void {
    if (this.paragraphLines.length === 0) {
      this.paragraphStartLine = lineNumber;
    }
    this.paragraphLines.push(line.trim());
  }

  private readonly actionHandlers: Record<
    StatementLineAction,
    StatementLineHandler
  > = {
    blank: (_lines, i) => {
      this.flushParagraph();

      return i;
    },
    heading: (_lines, i, line) => {
      this.flushParagraph();
      this.currentHeading = parseHeading(line);

      return i;
    },
    table: (_lines, i) => {
      this.flushParagraph();

      return i;
    },
    "list-item": (lines, i) => {
      this.flushParagraph();
      const itemStartLine = i + 1;
      const listItem = readListItemLines(lines, i);

      this.pushListItemStatement(listItem.combined, itemStartLine);

      return listItem.endIndex;
    },
    paragraph: (_lines, i, line) => {
      this.appendParagraphLine(line, i + 1);

      return i;
    },
  };

  /** Processes the line at index `i`; returns the index the outer loop should resume from (before its own `i++`). */
  processLine(lines: string[], i: number): number {
    const line = lines[i];

    if (/^\s*```/.test(line)) {
      this.flushParagraph();
      this.inFence = !this.inFence;

      return i;
    }

    if (this.inFence) {
      return i;
    }

    return this.actionHandlers[classifyStatementLine(line)](lines, i, line);
  }

  finish(): Statement[] {
    this.flushParagraph();

    return this.statements;
  }
}

export function segmentStatements(content: string): Statement[] {
  const lines = content.split(/\r?\n/);
  const accumulator = new StatementAccumulator();

  for (let i = 0; i < lines.length; i++) {
    i = accumulator.processLine(lines, i);
  }

  return accumulator.finish();
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

function firstEnclosingHeading(statements: Statement[]): string | null {
  const withHeading = statements.find((s) => s.enclosingHeading !== null);

  return withHeading ? withHeading.enclosingHeading : null;
}

/** Build intro ordinals (no heading or first heading). */
export function buildIntroOrdinals(statements: Statement[]): Set<number> {
  const ordinals = new Set<number>();
  const firstHeading = firstEnclosingHeading(statements);

  for (const s of statements) {
    if (s.enclosingHeading === null || s.enclosingHeading === firstHeading) {
      ordinals.add(s.ordinal);
    }
  }

  return ordinals;
}

function matchRuleCategory(
  rules: { match: RegExp; category: UntestableCategory }[],
  text: string,
): UntestableCategory | null {
  const rule = rules.find(({ match }) => match.test(text));

  return rule ? rule.category : null;
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

  const contentCategory = matchRuleCategory(CONTENT_RULES, statement.text);

  if (contentCategory) {
    return {
      testability: "untestable",
      category: contentCategory,
      matchedBySection: true,
    };
  }

  const heading = statement.enclosingHeading;
  const sectionCategory = heading
    ? matchRuleCategory(SECTION_RULES, heading)
    : null;

  if (sectionCategory) {
    return {
      testability: "untestable",
      category: sectionCategory,
      matchedBySection: true,
    };
  }

  return { testability: "testable", category: null, matchedBySection: false };
}
