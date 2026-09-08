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
  octokit: Octokit,
  owner: string,
  repo: string,
  fullName: string,
): Promise<string[]> {
  try {
    const { data: content } = await octokit.rest.repos.getContent({
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
  octokit: Octokit,
  target: SampledRepoRef,
  path: string,
): Promise<GetContentResult | null> {
  const { owner, repo, fullName } = target;

  try {
    const fetched = await octokit.rest.repos.getContent({ owner, repo, path });

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
  octokit: Octokit,
  target: SampledRepoRef,
  path: string,
): Promise<string | null> {
  const content = await getContentOrNull(octokit, target, path);

  return content ? fileContentIfPresent(content) : null;
}

async function fetchKeyFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  fullName: string,
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const ref = { owner, repo, fullName };

  await Promise.all(
    KEY_FILES.map(async (path) => {
      const decoded = await fetchOptionalFile(octokit, ref, path);

      if (decoded) {
        files[path] = decoded;
      }
    }),
  );

  return files;
}

/** 200 lines is enough to read a repo's style, which is all a sample is for. */
async function fetchSampleHead(
  octokit: Octokit,
  ref: SampledRepoRef,
  path: string,
): Promise<string | null> {
  const full = await fetchOptionalFile(octokit, ref, path);

  return full ? full.split("\n").slice(0, 200).join("\n") : null;
}

/** Fills `samples` (up to 3 entries) with the first 200 lines of each listed file. */
async function sampleSourceFiles(
  octokit: Octokit,
  ref: SampledRepoRef,
  entries: RepoFileEntry[],
  samples: Record<string, string>,
): Promise<void> {
  for (const entry of entries) {
    if (Object.keys(samples).length >= 3) {
      break;
    }

    const head = await fetchSampleHead(octokit, ref, entry.path);

    if (head) {
      samples[entry.path] = head;
    }
  }
}

/** The files in one directory, or none. */
async function listFilesIn(
  octokit: Octokit,
  target: SampledRepoRef,
  dir: string,
): Promise<RepoFileEntry[]> {
  const content = await getContentOrNull(octokit, target, dir);

  return Array.isArray(content)
    ? content.filter((entry) => entry.type === "file")
    : [];
}

async function fetchSamples(
  octokit: Octokit,
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

    const entries = await listFilesIn(octokit, ref, dir);

    await sampleSourceFiles(octokit, ref, entries, samples);
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

  const octokit = await getOctokit();
  const tree = await fetchTopLevelTree(octokit, owner, repo, fullName);
  const files = await fetchKeyFiles(octokit, owner, repo, fullName);
  const samples = await fetchSamples(octokit, owner, repo, fullName);

  return { tree, files, samples };
}
