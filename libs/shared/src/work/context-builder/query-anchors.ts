// What a task query names outright: the files, requirements and tickets the builder looks up before it searches.

export interface QueryAnchors {
  paths: string[];
  requirements: string[];
  numbers: number[];
}

const PATH_RE = /(?:[\w.-]+\/)+[\w.-]+\.\w+/g;
const REQUIREMENT_RE = /\b(?:FR|NFR|CR|SC)-?\d+(?:\.\d+)?[a-z]?\b/g;
const NUMBER_RE = /(?:#|\b(?:issue|PR|pull request|ticket) )(\d{2,6})\b/gi;

export function queryAnchors(query: string): QueryAnchors {
  return {
    paths: distinct(query.match(PATH_RE) ?? []).sort(),
    requirements: distinct(query.match(REQUIREMENT_RE) ?? []),
    numbers: distinct(
      [...query.matchAll(NUMBER_RE)].map((match) => Number(match[1])),
    ),
  };
}

function distinct<T>(values: T[]): T[] {
  return [...new Set(values)];
}
