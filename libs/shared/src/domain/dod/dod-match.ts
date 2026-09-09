/** Matches a Definition of Done's acceptance tests against the branch's latest CI test report (pipeline.test_reports): same file, then the best name match, so the run page can say which of "done when these pass" are green today. Pure. */

import type { DefinitionOfDone } from "./dod-markdown.js";

export interface MatchableTest {
  id: string;
  name: string;
  file: string;
}

export interface MatchableReport {
  tests: MatchableTest[];
  /** Test id → passed. */
  outcomes: Record<string, boolean>;
}

export type AcceptanceTestOutcome = "pass" | "fail" | "unknown";

export interface AcceptanceTestStatus {
  path: string;
  name: string;
  behaviour: string;
  status: AcceptanceTestOutcome;
  matchedId: string | null;
}

type Rank = (candidate: MatchableTest, path: string, name: string) => boolean;

/** Rank order: exact id, full name, leaf title, name ending in the DoD's title, loose leaf. */
const RANKS: readonly Rank[] = [
  (candidate, path, name) => candidate.id === `${path}::${name}`,
  (candidate, _path, name) => candidate.name === name,
  (candidate, _path, name) => leaf(candidate.name) === name,
  (candidate, _path, name) => candidate.name.endsWith(` > ${name}`),
  (candidate, _path, name) => loose(leaf(candidate.name)) === loose(name),
];

/** One status per acceptance test; every one is `unknown` when CI has posted no report for the branch. */
export function matchAcceptanceTests(
  dod: DefinitionOfDone,
  report: MatchableReport | null,
): AcceptanceTestStatus[] {
  return dod.acceptanceTests.map(({ path, name, behaviour }) => {
    const wanted = normalisePath(path);
    const candidates = (report?.tests ?? []).filter((candidate) =>
      sameFile(normalisePath(candidate.file), wanted),
    );
    const match = findMatch(candidates, wanted, name);

    return { path, name, behaviour, ...outcomeOf(report, match) };
  });
}

/** How many of the acceptance tests are green, out of how many there are. */
export function dodProgress(statuses: AcceptanceTestStatus[]): {
  passed: number;
  total: number;
} {
  return {
    passed: statuses.filter((status) => status.status === "pass").length,
    total: statuses.length,
  };
}

/** Repo-relative and slash-normalised: `./a/b.ts`, `/a/b.ts` and `a/b.ts` name the same file. */
export function normalisePath(path: string): string {
  return path.trim().replace(/^(?:\.\/|\/)+/, "");
}

function sameFile(a: string, b: string): boolean {
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function findMatch(
  candidates: MatchableTest[],
  path: string,
  name: string,
): MatchableTest | undefined {
  for (const rank of RANKS) {
    const hit = candidates.find((candidate) => rank(candidate, path, name));

    if (hit) {
      return hit;
    }
  }

  return undefined;
}

function outcomeOf(
  report: MatchableReport | null,
  match: MatchableTest | undefined,
): Pick<AcceptanceTestStatus, "status" | "matchedId"> {
  if (!match) {
    return { status: "unknown", matchedId: null };
  }

  return { status: statusOf(report?.outcomes[match.id]), matchedId: match.id };
}

function statusOf(passed: boolean | undefined): AcceptanceTestOutcome {
  if (passed === undefined) {
    return "unknown";
  }

  return passed ? "pass" : "fail";
}

function leaf(name: string): string {
  return name.split(" > ").at(-1) ?? name;
}

function loose(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}
