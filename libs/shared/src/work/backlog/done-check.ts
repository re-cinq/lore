// The implementation loop's "already done?" check before the definition-of-done pod (#3497): merged pull requests that name the ticket are shown to a small model with the ticket, and only its "done, by this pull request, because" closes the ticket. Over the weekend of 2026-10-23 the dod pod ended 294 of its 372 visits as already done or not testable, at about $2.07 each.
import type { PullRef } from "../../outbound/project/pulls/pull-requests-port.js";
import { issueNumberFromLoopBranch } from "./loop-merge-success.js";

/** Pull requests shown to the judge, newest first: enough for the change that did it, few enough to stay a small call. */
export const DONE_CHECK_CANDIDATES = 3;

/** How much of each pull request's diff the judge reads. */
export const DONE_CHECK_DIFF_CHARS = 20_000;

/** True when `text` names issue `number` of `repo`, as `#n` or by its URL. */
export function mentionsIssue(
  text: string,
  repo: string,
  number: number,
): boolean {
  const short = new RegExp(`(^|[^\\w/])#${number}(?!\\d)`);
  const url = `github.com/${repo}/issues/${number}`;
  const byUrl = new RegExp(`${url.replace(/[./]/g, "\\$&")}(?!\\d)`, "i");

  return short.test(text) || byUrl.test(text);
}

/** Code files the ticket's text names, at most this many, each looked up for the pull requests that touched it. */
export const NAMED_PATHS = 8;

const BLOB_PATH = /github\.com\/[\w.-]+\/[\w.-]+\/blob\/[^/\s]+\/([^\s#)?]+)/g;

const PATH_WORD = /(?<![\w./:-])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z]\w*)(?![\w/])/g;

/** The repository files a ticket names, by blob link, in backticks or bare, in order of first mention: not a spec, an ADR or markdown, which say what to do rather than where it was done. */
export function namedPaths(ticket: string): string[] {
  const linked = [...ticket.matchAll(BLOB_PATH)].map(placed);
  const blanked = ticket.replace(BLOB_PATH, (link) => " ".repeat(link.length));
  const bare = [...blanked.matchAll(PATH_WORD)].map(placed);
  const inOrder = [...linked, ...bare]
    .sort((a, b) => a.at - b.at)
    .map(({ path }) => path);

  return [...new Set(inOrder)]
    .filter((path) => !/^(specs|adrs)\//.test(path) && !path.endsWith(".md"))
    .slice(0, NAMED_PATHS);
}

function placed(match: RegExpMatchArray): { path: string; at: number } {
  return { path: match[1]!, at: match.index ?? 0 };
}

/** Where candidates come from: per named file, the merged pull requests that touched it; and the merged pull requests that name the ticket. */
export interface CandidatePools {
  touching: readonly (readonly PullRef[])[];
  naming: readonly PullRef[];
}

/** The pull requests shown to the judge: those that touched the most files the ticket names first, a pull request that names the ticket counting as one more, then the newest; never the loop's own branch for it. Tickets are often filed after the work that does them merged, so no date bounds them. */
export function doneCheckCandidates(
  pools: CandidatePools,
  repo: string,
  issueNumber: number,
): PullRef[] {
  const naming = pools.naming.filter((pull) =>
    mentionsIssue(`${pull.title}\n${pull.body ?? ""}`, repo, issueNumber),
  );

  return scored([...pools.touching.flat(), ...naming])
    .filter(
      ({ pull }) => issueNumberFromLoopBranch(pull.branch) !== issueNumber,
    )
    .sort(byScoreThenNewest)
    .slice(0, DONE_CHECK_CANDIDATES)
    .map(({ pull }) => pull);
}

/** Each pull request once, scored by how many times it was found. */
function scored(
  found: readonly PullRef[],
): Array<{ pull: PullRef; score: number }> {
  const scores = new Map<number, { pull: PullRef; score: number }>();

  for (const pull of found) {
    const seen = scores.get(pull.number) ?? { pull, score: 0 };

    scores.set(pull.number, { pull, score: seen.score + 1 });
  }

  return [...scores.values()];
}

function byScoreThenNewest(
  a: { pull: PullRef; score: number },
  b: { pull: PullRef; score: number },
): number {
  return (
    b.score - a.score ||
    (b.pull.mergedAt ?? "").localeCompare(a.pull.mergedAt ?? "")
  );
}

/** What the judge answers. */
export interface DoneCheckAnswer {
  done: boolean;
  pull: number | null;
  reason: string;
}

export const DONE_CHECK_TOOL_SCHEMA = {
  type: "object",
  properties: {
    done: {
      type: "boolean",
      description:
        "True only when one of the pull requests shown already does everything the ticket asks.",
    },
    pull: {
      type: ["integer", "null"],
      description: "The number of the pull request that does it, or null.",
    },
    reason: {
      type: "string",
      description:
        "One sentence: what in that pull request does what the ticket asks, or what is still missing.",
    },
  },
  required: ["done", "pull", "reason"],
} as const;

/** The resolved verdict as the ticket's closing comment carries it, or null when the ticket is not shown to be done. A closure names the pull request it points at and why, and only a pull request the judge was shown counts. */
export function doneCheckVerdict(
  answer: DoneCheckAnswer,
  candidates: readonly PullRef[],
): string | null {
  const pull = candidates.find((candidate) => candidate.number === answer.pull);
  const reason = answer.reason.trim();

  if (!answer.done || !pull || reason === "") {
    return null;
  }

  return `#${pull.number} ${pull.title} (${pull.url}) already does it: ${reason}`;
}

/** The judge's prompt: the ticket, then each candidate's title, body and diff. */
export function doneCheckPrompt(
  ticket: string,
  candidates: ReadonlyArray<{ pull: PullRef; diff: string }>,
): string {
  const shown = candidates
    .map(
      ({ pull, diff }) =>
        `## Pull request #${pull.number}: ${pull.title}\n\n${pull.body ?? ""}\n\n\`\`\`diff\n${diff.slice(0, DONE_CHECK_DIFF_CHARS)}\n\`\`\``,
    )
    .join("\n\n");

  return `Decide whether this ticket is already done by one of the merged pull requests below. Say done only when one of them does everything the ticket asks; a pull request that only mentions the ticket, or does part of it, is not done.\n\n# The ticket\n\n${ticket}\n\n# Merged pull requests that name it\n\n${shown}`;
}

/** The per-repository switch, `implementation_loop.done_check`, off by omission until the check's accuracy is measured on past closures. */
export function doneCheckEnabled(rawSettings: unknown): boolean {
  const block = (
    rawSettings as { implementation_loop?: { done_check?: unknown } } | null
  )?.implementation_loop;

  return block?.done_check === true;
}
