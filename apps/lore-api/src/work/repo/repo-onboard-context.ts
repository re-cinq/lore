import { errorMessage } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { getOctokit } from "../../outbound/github-client.js";

// ── Fetch repo context for onboarding agents ────────────────────────

export interface RepoContext {
  tree: string[];
  files: Record<string, string>;
  samples: Record<string, string>;
}

const KEY_FILES = [
  "README.md",
  "CLAUDE.md",
  "AGENTS.md",
  "package.json",
  "go.mod",
  "Cargo.toml",
  "requirements.txt",
  "Dockerfile",
  "docker-compose.yml",
  "pom.xml",
  "Makefile",
  "tsconfig.json",
  "pyproject.toml",
];

const SAMPLE_DIRS = ["src", "lib", "cmd", "internal", "app", "pkg"];

/** Decodes base64-encoded file content returned by the GitHub API. */
function decodeContent(encoded: string): string {
  return Buffer.from(encoded, "base64").toString("utf-8");
}

type Octokit = Awaited<ReturnType<typeof getOctokit>>;

type ReposApi = Octokit["rest"]["repos"];

type GetContentResult = Awaited<
  ReturnType<Octokit["rest"]["repos"]["getContent"]>
>["data"];

interface SampledRepoRef {
  owner: string;
  repo: string;
  fullName: string;
}

type RepoFileEntry = { name: string; path: string; type: string };

/** Extracts file content from a GitHub `getContent` response, or null for a dir/empty file. */
function fileContentIfPresent(content: GetContentResult): string | null {
  if (Array.isArray(content)) {
    return null;
  }

  return content.type === "file" && content.content
    ? decodeContent(content.content)
    : null;
}

async function fetchTopLevelTree(
  reposApi: ReposApi,
  owner: string,
  repo: string,
  fullName: string,
): Promise<string[]> {
  try {
    const { data: content } = await reposApi.getContent({
      owner,
      repo,
      path: "",
    });

    return Array.isArray(content) ? content.map((entry) => entry.name) : [];
  } catch (err) {
    console.error(
      `[onboard] Failed to fetch tree for ${fullName}: ${errorMessage(err)}`,
    );

    return [];
  }
}

/** A 404 is SILENT — most repos hold only some of these paths, and logging every absent one would bury the errors that matter. */
async function getContentOrNull(
  reposApi: ReposApi,
  target: SampledRepoRef,
  path: string,
): Promise<GetContentResult | null> {
  const { owner, repo, fullName } = target;

  try {
    const fetched = await reposApi.getContent({ owner, repo, path });

    return fetched.data;
  } catch (err) {
    if ((err as { status?: number }).status !== 404) {
      console.error(
        `[onboard] Error fetching ${fullName}/${path}: ${errorMessage(err)}`,
      );
    }

    return null;
  }
}

async function fetchOptionalFile(
  reposApi: ReposApi,
  target: SampledRepoRef,
  path: string,
): Promise<string | null> {
  const content = await getContentOrNull(reposApi, target, path);

  return content ? fileContentIfPresent(content) : null;
}

async function fetchKeyFiles(
  reposApi: ReposApi,
  owner: string,
  repo: string,
  fullName: string,
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const ref = { owner, repo, fullName };

  await Promise.all(
    KEY_FILES.map(async (path) => {
      const decoded = await fetchOptionalFile(reposApi, ref, path);

      if (decoded) {
        files[path] = decoded;
      }
    }),
  );

  return files;
}

/** 200 lines is enough to read a repo's style, which is all a sample is for. */
async function fetchSampleHead(
  reposApi: ReposApi,
  ref: SampledRepoRef,
  path: string,
): Promise<string | null> {
  const full = await fetchOptionalFile(reposApi, ref, path);

  return full ? full.split("\n").slice(0, 200).join("\n") : null;
}

/** Fills `samples` (up to 3 entries) with the first 200 lines of each listed file. */
async function sampleSourceFiles(
  reposApi: ReposApi,
  ref: SampledRepoRef,
  entries: RepoFileEntry[],
  samples: Record<string, string>,
): Promise<void> {
  for (const entry of entries) {
    if (Object.keys(samples).length >= 3) {
      break;
    }

    const head = await fetchSampleHead(reposApi, ref, entry.path);

    if (head) {
      samples[entry.path] = head;
    }
  }
}

/** The files in one directory, or none. */
async function listFilesIn(
  reposApi: ReposApi,
  target: SampledRepoRef,
  dir: string,
): Promise<RepoFileEntry[]> {
  const content = await getContentOrNull(reposApi, target, dir);

  return Array.isArray(content)
    ? content.filter((entry) => entry.type === "file")
    : [];
}

async function fetchSamples(
  reposApi: ReposApi,
  owner: string,
  repo: string,
  fullName: string,
): Promise<Record<string, string>> {
  const samples: Record<string, string> = {};
  const ref = { owner, repo, fullName };

  for (const dir of SAMPLE_DIRS) {
    if (Object.keys(samples).length >= 3) {
      break;
    }

    const entries = await listFilesIn(reposApi, ref, dir);

    await sampleSourceFiles(reposApi, ref, entries, samples);
  }

  return samples;
}

/** Fetches repo context (tree, key files, source samples) for onboarding agents to understand tech stack. */
export async function fetchRepoContext(fullName: string): Promise<RepoContext> {
  const [owner, repo] = fullName.split("/");

  enforceTrue(
    !(!owner || !repo),
    Error,
    `Invalid repo full_name: "${fullName}". Expected "owner/repo" format.`,
  );

  const { rest } = await getOctokit();
  const reposApi = rest.repos;
  const tree = await fetchTopLevelTree(reposApi, owner, repo, fullName);
  const files = await fetchKeyFiles(reposApi, owner, repo, fullName);
  const samples = await fetchSamples(reposApi, owner, repo, fullName);

  return { tree, files, samples };
}
