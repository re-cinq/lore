import { getOctokit } from "./github.js";

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

function decodeContent(encoded: string): string {
  return Buffer.from(encoded, "base64").toString("utf-8");
}

/**
 * Fetches contextual information about a repo: top-level tree, key config
 * files, and a sample of source files from well-known directories.
 */
export async function fetchRepoContext(
  fullName: string,
): Promise<RepoContext> {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) {
    throw new Error(
      `Invalid repo full_name: "${fullName}". Expected "owner/repo" format.`,
    );
  }

  const octokit = await getOctokit();

  // 1. Fetch top-level tree
  let tree: string[] = [];
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: "",
    });
    if (Array.isArray(data)) {
      tree = data.map((entry: any) => entry.name);
    }
  } catch (err: any) {
    console.error(
      `[agent] Failed to fetch tree for ${fullName}: ${err.message}`,
    );
  }

  // 2. Fetch key files in parallel (skip 404s)
  const files: Record<string, string> = {};
  await Promise.all(
    KEY_FILES.map(async (path) => {
      try {
        const { data } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path,
        });
        if (!Array.isArray(data) && data.type === "file" && data.content) {
          files[path] = decodeContent(data.content);
        }
      } catch (err: any) {
        if (err.status !== 404) {
          console.error(
            `[agent] Error fetching ${fullName}/${path}: ${err.message}`,
          );
        }
      }
    }),
  );

  // 3. Sample up to 3 source files from well-known directories
  const samples: Record<string, string> = {};
  for (const dir of SAMPLE_DIRS) {
    if (Object.keys(samples).length >= 3) break;

    let entries: any[] = [];
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: dir,
      });
      if (Array.isArray(data)) {
        entries = data.filter((e: any) => e.type === "file");
      }
    } catch (err: any) {
      if (err.status !== 404) {
        console.error(
          `[agent] Error listing ${fullName}/${dir}: ${err.message}`,
        );
      }
      continue;
    }

    for (const entry of entries) {
      if (Object.keys(samples).length >= 3) break;
      try {
        const { data } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: entry.path,
        });
        if (!Array.isArray(data) && data.type === "file" && data.content) {
          const full = decodeContent(data.content);
          const first200 = full.split("\n").slice(0, 200).join("\n");
          samples[entry.path] = first200;
        }
      } catch (err: any) {
        console.error(
          `[agent] Error fetching sample ${fullName}/${entry.path}: ${err.message}`,
        );
      }
    }
  }

  return { tree, files, samples };
}
