// What a task query names outright: the files, requirements, tickets and quoted literals the builder looks up before it searches.

export interface QueryAnchors {
  paths: string[];
  requirements: string[];
  numbers: number[];
  /** Quoted strings and backticked identifiers: a log line, a label, a function name, found in code by its text rather than by a path. */
  literals: string[];
}

const PATH_RE = /(?:[\w.-]+\/)+[\w.-]+\.\w+/g;
const REQUIREMENT_RE = /\b(?:FR|NFR|CR|SC)-?\d+(?:\.\d+)?[a-z]?\b/g;
const NUMBER_RE = /(?:#|\b(?:issue|PR|pull request|ticket) )(\d{2,6})\b/gi;
const PATH_SHAPE = /^(?:[\w.-]+\/)+[\w.-]+\.\w+$/;
const LITERAL_RE = /`([^`\n]{3,80})`|"([^"\n]{6,80})"|'([^'\n]{6,80})'/g;
const MAX_LITERALS = 6;

export function queryAnchors(query: string): QueryAnchors {
  return {
    paths: distinct(query.match(PATH_RE) ?? []).sort(),
    requirements: distinct(query.match(REQUIREMENT_RE) ?? []),
    numbers: distinct(
      [...query.matchAll(NUMBER_RE)].map((match) => Number(match[1])),
    ),
    literals: distinct(
      [...query.matchAll(LITERAL_RE)].map((match) => quotedOf(match)),
    )
      .filter((literal) => !PATH_SHAPE.test(literal))
      .slice(0, MAX_LITERALS),
  };
}

/** Whichever of the three quote styles matched. */
function quotedOf(match: RegExpMatchArray): string {
  const [backticked, doubleQuoted, singleQuoted] = match.slice(1) as (
    string | undefined
  )[];

  return backticked ?? doubleQuoted ?? singleQuoted ?? "";
}

function distinct<T>(values: T[]): T[] {
  return [...new Set(values)];
}
