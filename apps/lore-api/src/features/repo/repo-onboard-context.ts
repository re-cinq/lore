import { errorMessage } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { getOctokit } from "../../platform/github-client.js";

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

type GetContentResult = Awaited<
  ReturnType<
    Awaited<ReturnType<typeof getOctokit>>["rest"]["repos"]["getContent"]
  >
>["data"];

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
  octokit: Awaited<ReturnType<typeof getOctokit>>,
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

async function fetchKeyFiles(
  octokit: Awaited<ReturnType<typeof getOctokit>>,
  owner: string,
  repo: string,
  fullName: string,
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};

  await Promise.all(
    KEY_FILES.map(async (path) => {
      try {
        const { data: content } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path,
        });
        const decoded = fileContentIfPresent(content);

        if (decoded) {
          files[path] = decoded;
        }
      } catch (err) {
        if ((err as { status?: number }).status !== 404) {
          console.error(
            `[onboard] Error fetching ${fullName}/${path}: ${errorMessage(err)}`,
          );
        }
      }
    }),
  );

  return files;
}

interface SampledRepoRef {
  owner: string;
  repo: string;
  fullName: string;
}

/** Fills `samples` (up to 3 entries) with the first 200 lines of each listed file. */
async function sampleSourceFiles(
  octokit: Awaited<ReturnType<typeof getOctokit>>,
  ref: SampledRepoRef,
  entries: Array<{ name: string; path: string; type: string }>,
  samples: Record<string, string>,
): Promise<void> {
  for (const entry of entries) {
    if (Object.keys(samples).length >= 3) {
      break;
    }

    try {
      const { data: content } = await octokit.rest.repos.getContent({
        owner: ref.owner,
        repo: ref.repo,
        path: entry.path,
      });
      const full = fileContentIfPresent(content);

      if (full) {
        samples[entry.path] = full.split("\n").slice(0, 200).join("\n");
      }
    } catch (err) {
      console.error(
        `[onboard] Error fetching sample ${ref.fullName}/${entry.path}: ${errorMessage(err)}`,
      );
    }
  }
}

async function fetchSamples(
  octokit: Awaited<ReturnType<typeof getOctokit>>,
  owner: string,
  repo: string,
  fullName: string,
): Promise<Record<string, string>> {
  const samples: Record<string, string> = {};

  for (const dir of SAMPLE_DIRS) {
    if (Object.keys(samples).length >= 3) {
      break;
    }

    let entries: Array<{ name: string; path: string; type: string }> = [];

    try {
      const { data: content } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: dir,
      });

      if (Array.isArray(content)) {
        entries = content.filter((e) => e.type === "file");
      }
    } catch (err) {
      if ((err as { status?: number }).status !== 404) {
        console.error(
          `[onboard] Error listing ${fullName}/${dir}: ${errorMessage(err)}`,
        );
      }
      continue;
    }

    await sampleSourceFiles(
      octokit,
      { owner, repo, fullName },
      entries,
      samples,
    );
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
