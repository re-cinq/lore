import { errorMessage } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { projectFor } from "../../kernel/project-boot.js";

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

/** Reads up to the 3-sample cap from one directory's entries (first 200 lines each); per-file read failures are logged and skipped. */
async function sampleDirEntries(
  project: Awaited<ReturnType<typeof projectFor>>,
  fullName: string,
  { dir, entries }: { dir: string; entries: string[] },
  samples: Record<string, string>,
): Promise<void> {
  for (const entryName of entries) {
    if (Object.keys(samples).length >= 3) {
      return;
    }
    const entryPath = `${dir}/${entryName}`;

    try {
      const content = await project.repo.read(entryPath);

      if (content !== null) {
        const first200 = content.split("\n").slice(0, 200).join("\n");

        samples[entryPath] = first200;
      }
    } catch (err) {
      console.error(
        `[floor] Error fetching sample ${fullName}/${entryPath}: ${errorMessage(err)}`,
      );
    }
  }
}

/** Fetches contextual information about a repo: top-level tree, key config files, and a sample of source files from well-known directories. */
export async function fetchRepoContext(fullName: string): Promise<RepoContext> {
  const [owner, repo] = fullName.split("/");

  enforceTrue(
    owner && repo,
    Error,
    `Invalid repo full_name: "${fullName}". Expected "owner/repo" format.`,
  );
  const project = await projectFor(fullName);

  // 1. Fetch top-level tree
  let tree: string[] = [];

  try {
    tree = await project.repo.list("");
  } catch (err) {
    console.error(
      `[floor] Failed to fetch tree for ${fullName}: ${errorMessage(err)}`,
    );
  }

  // 2. Fetch key files in parallel (skip missing)
  const files: Record<string, string> = {};

  await Promise.all(
    KEY_FILES.map(async (path) => {
      try {
        const content = await project.repo.read(path);

        if (content !== null) {
          files[path] = content;
        }
      } catch (err) {
        console.error(
          `[floor] Error fetching ${fullName}/${path}: ${errorMessage(err)}`,
        );
      }
    }),
  );

  // 3. Sample up to 3 source files from well-known directories
  const samples: Record<string, string> = {};

  for (const dir of SAMPLE_DIRS) {
    if (Object.keys(samples).length >= 3) {
      break;
    }

    let entries: string[];

    try {
      entries = await project.repo.list(dir);
    } catch (err) {
      console.error(
        `[floor] Error listing ${fullName}/${dir}: ${errorMessage(err)}`,
      );
      continue;
    }

    await sampleDirEntries(project, fullName, { dir, entries }, samples);
  }

  return { tree, files, samples };
}
