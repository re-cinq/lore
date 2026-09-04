import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  getOctokit,
  isAppConfigured as isConfigured,
} from "../../platform/github-client.js";

// Resolves one ingest file's content: inline content wins, else fetches it from GitHub (falling back to HEAD).

export type IngestFile = string | { path: string; content: string };

interface GitHubFileTarget {
  owner: string;
  repoName: string;
  filePath: string;
  commit: string;
}

type FetchErrorOutcome = "retry" | "missing" | "throw";

/** Decides how to react to a failed ref fetch: retry the next ref, report the file missing, or rethrow. */
function classifyFetchError(
  status: number | undefined,
  ref: string,
  commit: string,
): FetchErrorOutcome {
  if (status !== 404) {
    return "throw";
  }

  return ref === commit && commit !== "HEAD" ? "retry" : "missing";
}

type GetContentEntry = Awaited<
  ReturnType<
    Awaited<ReturnType<typeof getOctokit>>["rest"]["repos"]["getContent"]
  >
>["data"];

function extractEntryContent(entry: GetContentEntry): string | null {
  return "content" in entry
    ? Buffer.from(entry.content, "base64").toString("utf-8")
    : null;
}

/** Fetches file content at the commit, falling back to HEAD when the commit is unknown to the repo. */
async function fetchFileWithHeadFallback(
  octokit: Awaited<ReturnType<typeof getOctokit>>,
  target: GitHubFileTarget,
): Promise<{ content: string | null; missing404: boolean }> {
  for (const ref of [target.commit, "HEAD"]) {
    try {
      const { data: entry } = await octokit.rest.repos.getContent({
        owner: target.owner,
        repo: target.repoName,
        path: target.filePath,
        ref,
      });

      return { content: extractEntryContent(entry), missing404: false };
    } catch (err) {
      const status = (err as { status?: number }).status;
      const outcome = classifyFetchError(status, ref, target.commit);

      if (outcome === "retry") {
        continue;
      }

      if (outcome === "missing") {
        return { content: null, missing404: true };
      }
      throw err;
    }
  }

  return { content: null, missing404: false };
}

export interface GithubFetchContext {
  octokit: Awaited<ReturnType<typeof getOctokit>>;
  owner: string;
  repoName: string;
}

/** Resolves GitHub access only when the batch has path-based (non-inline) entries. */
export async function resolveGithubFetchContext(
  files: IngestFile[],
  repo: string,
): Promise<GithubFetchContext | null> {
  if (!files.some((f) => typeof f === "string")) {
    return null;
  }

  enforceTrue(
    isConfigured(),
    Error,
    "GitHub App not configured — cannot fetch file content",
  );
  const octokit = await getOctokit();
  const [owner, repoName] = repo.split("/");

  return { octokit, owner, repoName };
}

/** Resolves a file's content: inline content wins, otherwise fetches from GitHub. */
export async function resolveFileContent(
  fileEntry: IngestFile,
  githubCtx: GithubFetchContext | null,
  filePath: string,
  commit: string,
): Promise<{ content: string | null; missing404: boolean }> {
  const inlineContent =
    typeof fileEntry !== "string" && fileEntry.content
      ? fileEntry.content
      : null;

  if (inlineContent) {
    return { content: inlineContent, missing404: false };
  }

  return fetchFileWithHeadFallback(githubCtx!.octokit, {
    owner: githubCtx!.owner,
    repoName: githubCtx!.repoName,
    filePath,
    commit,
  });
}
