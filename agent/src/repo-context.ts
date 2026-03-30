import { platform } from "./platform.js";

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

  // 1. Fetch top-level tree
  let tree: string[] = [];
  try {
    tree = await platform().listDirectory(fullName, "");
  } catch (err: any) {
    console.error(
      `[agent] Failed to fetch tree for ${fullName}: ${err.message}`,
    );
  }

  // 2. Fetch key files in parallel (skip missing)
  const files: Record<string, string> = {};
  await Promise.all(
    KEY_FILES.map(async (path) => {
      try {
        const content = await platform().getFileContent(fullName, path);
        if (content !== null) {
          files[path] = content;
        }
      } catch (err: any) {
        console.error(
          `[agent] Error fetching ${fullName}/${path}: ${err.message}`,
        );
      }
    }),
  );

  // 3. Sample up to 3 source files from well-known directories
  const samples: Record<string, string> = {};
  for (const dir of SAMPLE_DIRS) {
    if (Object.keys(samples).length >= 3) break;

    let entries: string[] = [];
    try {
      entries = await platform().listDirectory(fullName, dir);
    } catch (err: any) {
      console.error(
        `[agent] Error listing ${fullName}/${dir}: ${err.message}`,
      );
      continue;
    }

    for (const entryName of entries) {
      if (Object.keys(samples).length >= 3) break;
      const entryPath = `${dir}/${entryName}`;
      try {
        const content = await platform().getFileContent(fullName, entryPath);
        if (content !== null) {
          const first200 = content.split("\n").slice(0, 200).join("\n");
          samples[entryPath] = first200;
        }
      } catch (err: any) {
        console.error(
          `[agent] Error fetching sample ${fullName}/${entryPath}: ${err.message}`,
        );
      }
    }
  }

  return { tree, files, samples };
}
