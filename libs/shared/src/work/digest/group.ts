import type { IssueRef } from "../../outbound/project/lib/github-port.js";
import type { PullRef } from "../../outbound/project/pulls/pull-requests-port.js";
import type { Changes } from "./dedupe.js";

/** One entry per person across a channel's repos (specs/daily-digest FR5): what they did since the last digest and what they plan to do next. */

export type DigestChange = PullRef | IssueRef;

/** One repo's work, already deduped: `did` is what merged and closed, `next` the open pull requests and the open issues none of them claims. */
export interface RepoWork {
  did: Changes;
  next: Changes;
}

export interface PersonWork {
  login: string;
  did: DigestChange[];
  next: DigestChange[];
}

type Side = "did" | "next";

interface Owned {
  login: string;
  side: Side;
  change: DigestChange;
}

export const UNASSIGNED = "unassigned";

/** People sorted by login; a pull request is its author's, an issue each of its assignees'. A closed issue nobody was assigned to goes under `unassigned`; an open one says nothing about who is busy and is left out. */
export function groupPeople(repos: RepoWork[]): PersonWork[] {
  const owned = repos.flatMap(({ did, next }) => [
    ...ownedBy("did", did, [UNASSIGNED]),
    ...ownedBy("next", next, []),
  ]);
  const people = owned.reduce((acc, { login, side, change }) => {
    const person = acc.get(login) ?? { login, did: [], next: [] };

    return acc.set(login, { ...person, [side]: [...person[side], change] });
  }, new Map<string, PersonWork>());

  return [...people.values()].sort((a, b) => a.login.localeCompare(b.login));
}

/** Pull requests come before issues, so a person's next leads with the work already in review. */
function ownedBy(
  side: Side,
  { prs, issues }: Changes,
  nobody: string[],
): Owned[] {
  const fromPrs = prs.map((pr) => ({
    login: pr.author || UNASSIGNED,
    side,
    change: pr,
  }));
  const fromIssues = issues.flatMap((issue) =>
    assigneesOr(issue, nobody).map((login) => ({ login, side, change: issue })),
  );

  return [...fromPrs, ...fromIssues];
}

function assigneesOr(issue: IssueRef, nobody: string[]): string[] {
  const assignees = issue.assignees ?? [];

  return assignees.length > 0 ? assignees : nobody;
}
