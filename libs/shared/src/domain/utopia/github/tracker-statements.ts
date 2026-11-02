// One pull request or issue as the statements of Utopia's identity source: its name, its number as `#n` and `repo#n`, its title and link, who opened it and, for a pull request, the issues its title and description close or refer to, so the identifiers exist as exact names before an AI reads the prose.

import { authorFragment } from "../author.js";
import { ISSUE_RE, issueRelation } from "../git-history/commit-text.js";
import {
  cutText,
  joinFragments,
  splitToFit,
  type Fragment,
} from "../fragments.js";
import { githubPage, issueName, pullRequestName } from "../names.js";
import {
  attribute,
  knownAs,
  relation,
  type StatementItem,
} from "../statements.js";
import type { TrackedEntry } from "./tracker-text.js";

export function trackedStatementItems(
  repo: string,
  entry: TrackedEntry,
): StatementItem[] {
  const isPull = entry.kind === "pull";
  const subject = isPull
    ? pullRequestName(repo, entry.number)
    : issueName(repo, entry.number);
  const head = headOf(repo, entry, subject);
  const parts = isPull ? issueFragments(repo, subject, entry) : [];

  return splitToFit(`${entry.kind}:${entry.number}`, parts, (part) =>
    joinFragments(head, part),
  ).map((pushed) => ({ ...pushed, doc_time: entry.updatedAt }));
}

function headOf(repo: string, entry: TrackedEntry, subject: string): Fragment {
  const author = authorFragment(subject, entry.author);

  return {
    e: [
      [subject, entry.kind === "pull" ? "PullRequest" : "Issue", true],
      ...author.e,
    ],
    s: [
      knownAs(subject, `#${entry.number}`),
      knownAs(subject, `${repo}#${entry.number}`),
      attribute(subject, "title", cutText(entry.title)),
      attribute(subject, "permalink", githubPage(subject)),
      ...author.s,
    ],
  };
}

function issueFragments(
  repo: string,
  subject: string,
  entry: TrackedEntry,
): Fragment[] {
  return [...`${entry.title}\n${entry.body}`.matchAll(ISSUE_RE)].map(
    ([, keyword, number]) => {
      const issue = issueName(repo, Number(number));

      return {
        e: [[issue, "Issue", true]],
        s: [relation(subject, issueRelation(keyword), issue)],
      };
    },
  );
}
