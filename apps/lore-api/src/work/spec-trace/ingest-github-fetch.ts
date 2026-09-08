import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  getOctokit,
  isAppConfigured as isConfigured,
} from "../../outbound/github-client.js";

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

type ReposApi = Awaited<ReturnType<typeof getOctokit>>["rest"]["repos"];

type GetContentEntry = Awaited<ReturnType<ReposApi["getContent"]>>["data"];

function extractEntryContent(entry: GetContentEntry): string | null {
  return "content" in entry
    ? Buffer.from(entry.content, "base64").toString("utf-8")
    : null;
}

interface FetchedFile {
  content: string | null;
  missing404: boolean;
}

/** Null means "try the next ref" — the only outcome that is neither an answer nor a failure. */
function settleRefFetchError(
  err: unknown,
  ref: string,
  commit: string,
): FetchedFile | null {
  const outcome = classifyFetchError(
    (err as { status?: number }).status,
    ref,
    commit,
  );

  if (outcome === "throw") {
    throw err;
  }

  return outcome === "missing" ? { content: null, missing404: true } : null;
}

/** One ref's attempt, separated from the ref sequence so the fallback reads as a loop over refs rather than a nested catch. */
async function fetchAtRef(
  repos: ReposApi,
  target: GitHubFileTarget,
  ref: string,
): Promise<FetchedFile | null> {
  try {
    const { data: entry } = await repos.getContent({
      owner: target.owner,
      repo: target.repoName,
      path: target.filePath,
      ref,
    });

    return { content: extractEntryContent(entry), missing404: false };
  } catch (err) {
    return settleRefFetchError(err, ref, target.commit);
  }
}

/** Fetches file content at the commit, falling back to HEAD when the commit is unknown to the repo. */
async function fetchFileWithHeadFallback(
  repos: ReposApi,
  target: GitHubFileTarget,
): Promise<FetchedFile> {
  for (const ref of [target.commit, "HEAD"]) {
    const fetched = await fetchAtRef(repos, target, ref);

    if (fetched) {
      return fetched;
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

/** The content posted inline with the file entry, when the caller sent one. An empty string is content the caller supplied, not an absent one: treating it as absent sent an inline entry down the GitHub path with no client to fetch with. */
function inlineContentOf(fileEntry: IngestFile): string | null {
  return typeof fileEntry === "string" ? null : fileEntry.content;
}

/** Resolves a file's content: inline content wins, otherwise fetches from GitHub. */
export async function resolveFileContent(
  fileEntry: IngestFile,
  githubCtx: GithubFetchContext | null,
  filePath: string,
  commit: string,
): Promise<{ content: string | null; missing404: boolean }> {
  const inlineContent = inlineContentOf(fileEntry);

  if (inlineContent !== null) {
    return { content: inlineContent, missing404: false };
  }

  const { octokit, owner, repoName } = githubCtx!;

  return fetchFileWithHeadFallback(octokit.rest.repos, {
    owner,
    repoName,
    filePath,
    commit,
  });
}
