import type { Octokit } from "octokit";
import type { BranchHistoryOptions, CommitDetail } from "./github-port.js";
import { split } from "./platform-github-support.js";
import type { ReposApi } from "./platform-github-api.js";

/** The branch's commits above `until`, GitHub's newest-first pages walked until the cursor is seen (or the root without one), then the oldest `limit` read in detail and answered oldest-first, so a run that cannot finish the history leaves a cursor the next one continues from. */
export async function listBranchHistory(
  ok: Octokit,
  repo: string,
  branch: string,
  opts: BranchHistoryOptions,
): Promise<CommitDetail[]> {
  const newestFirst = await shasAbove(ok, repo, branch, opts.until);
  const oldestFirst = newestFirst.reverse().slice(0, opts.limit);
  const details: CommitDetail[] = [];

  for (const sha of oldestFirst) {
    details.push(await commitDetail(ok.rest.repos, repo, sha));
  }

  return details;
}

async function shasAbove(
  ok: Octokit,
  repo: string,
  branch: string,
  until: string | undefined,
): Promise<string[]> {
  const shas: string[] = [];

  for await (const page of commitPages(ok, repo, branch)) {
    const above = shasUntil(page.data, until);

    shas.push(...above.shas);

    if (above.reached) {
      break;
    }
  }

  return shas;
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

/** The page's shas before the cursor, and whether the cursor was on the page. */
function shasUntil(
  page: Array<{ sha: string }>,
  until: string | undefined,
): { shas: string[]; reached: boolean } {
  const at = page.findIndex((commit) => commit.sha === until);

  return at === -1
    ? { shas: page.map((commit) => commit.sha), reached: false }
    : { shas: page.slice(0, at).map((commit) => commit.sha), reached: true };
}

async function commitDetail(
  repos: ReposApi,
  repo: string,
  sha: string,
): Promise<CommitDetail> {
  const { data: detail } = await repos.getCommit(commitRef(repo, sha));
  const { commit, parents, files } = detail;

  return {
    sha: detail.sha,
    parents: parents.map((parent) => parent.sha),
    ...messageParts(commit.message),
    author: commit.author?.name ?? "",
    authoredAt: commit.author?.date ?? "",
    files: changedPaths(files ?? []),
  };
}

function commitRef(
  repo: string,
  sha: string,
): { owner: string; repo: string; ref: string } {
  const [owner, name] = split(repo);

  return { owner, repo: name, ref: sha };
}

function changedPaths(
  files: Array<{ filename: string; status: string }>,
): CommitDetail["files"] {
  return files.map((file) => ({ path: file.filename, status: file.status }));
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
