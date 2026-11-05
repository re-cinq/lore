// What a task query names outright: the files, requirements, tickets and quoted literals the builder looks up before it searches.

export interface QueryAnchors {
  paths: string[];
  requirements: string[];
  numbers: number[];
  /** Quoted strings and backticked identifiers: a log line, a label, a function name, found in code by its text rather than by a path. */
  literals: string[];
  /** The repository files the task links as GitHub blob URLs, each with the line its `#L` names. */
  links: LinkedLine[];
}

export interface LinkedLine {
  path: string;
  line: number | null;
}

const PATH_RE = /(?:[\w.-]+\/)+[\w.-]+\.\w+/g;
const REQUIREMENT_RE = /\b(?:FR|NFR|CR|SC)-?\d+(?:\.\d+)?[a-z]?\b/g;
const NUMBER_RE = /(?:#|\b(?:issue|PR|pull request|ticket) )(\d{2,6})\b/gi;
const PATH_SHAPE = /^(?:[\w.-]+\/)+[\w.-]+\.\w+$/;
const LITERAL_RE = /`([^`\n]{3,80})`|"([^"\n]{6,80})"|'([^'\n]{6,80})'/g;
const MAX_LITERALS = 6;
const BLOB_LINK_RE =
  /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/blob\/[\w.-]+\/([^\s#)]+)(?:#L(\d+))?/g;
const MAX_LINKS = 8;

export function queryAnchors(query: string): QueryAnchors {
  const links = linkedLines(query);
  const unlinked = query.replace(BLOB_LINK_RE, " ");

  return {
    paths: distinct([
      ...(unlinked.match(PATH_RE) ?? []),
      ...links.map((link) => link.path),
    ]).sort(),
    requirements: distinct(query.match(REQUIREMENT_RE) ?? []),
    numbers: distinct(
      [...query.matchAll(NUMBER_RE)].map((match) => Number(match[1])),
    ),
    literals: distinct(
      [...query.matchAll(LITERAL_RE)].map((match) => quotedOf(match)),
    )
      .filter((literal) => !PATH_SHAPE.test(literal))
      .slice(0, MAX_LITERALS),
    links,
  };
}

/** Each linked path once, the first link's line winning. */
function linkedLines(query: string): LinkedLine[] {
  const links = [...query.matchAll(BLOB_LINK_RE)].map((match): LinkedLine => ({
    path: match[1],
    line: match[2] ? Number(match[2]) : null,
  }));
  const firstOfPath = new Map<string, LinkedLine>();

  for (const link of links) {
    if (!firstOfPath.has(link.path)) {
      firstOfPath.set(link.path, link);
    }
  }

  return [...firstOfPath.values()].slice(0, MAX_LINKS);
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
