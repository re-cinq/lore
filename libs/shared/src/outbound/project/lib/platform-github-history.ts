import type { Octokit } from "octokit";
import type { BranchHistoryOptions, CommitDetail } from "./github-port.js";
import { split } from "./platform-github-support.js";

/** One commit as GitHub's commit listing carries it. */
interface ListedCommit {
  sha: string;
  parents: Array<{ sha: string }>;
  commit: {
    message: string;
    author?: { name?: string; date?: string } | null;
  };
}

/** The newest `limit` commits of the branch above `until` (the whole branch without it), read from the commit listing alone and answered oldest-first: a walk pushes them in the order they were made and leaves the newest as its cursor. */
export async function listBranchHistory(
  ok: Octokit,
  repo: string,
  branch: string,
  opts: BranchHistoryOptions,
): Promise<CommitDetail[]> {
  const newestFirst: CommitDetail[] = [];

  for await (const page of commitPages(ok, repo, branch)) {
    const above = commitsUntil(page.data, opts.until);

    newestFirst.push(...above.commits.map(detailOf));

    if (above.reached || newestFirst.length >= opts.limit) {
      break;
    }
  }

  return newestFirst.slice(0, opts.limit).reverse();
}

/** GitHub's pages of the branch's commits, newest first. */
function commitPages(ok: Octokit, repo: string, branch: string) {
  const [owner, name] = split(repo);
  const { repos } = ok.rest;

  return ok.paginate.iterator(repos.listCommits, {
    owner,
    repo: name,
    sha: branch,
    per_page: 100,
  });
}

/** The page's commits before the cursor, and whether the cursor was on the page. */
function commitsUntil(
  page: ListedCommit[],
  until: string | undefined,
): { commits: ListedCommit[]; reached: boolean } {
  const at = page.findIndex((listed) => listed.sha === until);

  return at === -1
    ? { commits: page, reached: false }
    : { commits: page.slice(0, at), reached: true };
}

function detailOf({ sha, parents, commit }: ListedCommit): CommitDetail {
  return {
    sha,
    parents: parents.map((parent) => parent.sha),
    ...messageParts(commit.message),
    author: commit.author?.name ?? "",
    authoredAt: commit.author?.date ?? "",
  };
}

/** The first line is the subject, the rest the body. */
function messageParts(message: string): Pick<CommitDetail, "subject" | "body"> {
  const newline = message.indexOf("\n");

  return newline === -1
    ? { subject: message, body: "" }
    : {
        subject: message.slice(0, newline),
        body: message.slice(newline + 1).trim(),
      };
}
