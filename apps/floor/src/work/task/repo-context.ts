import type { Project } from "@re-cinq/lore-shared";
import { errorMessage } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { projectFor } from "../../outbound/project-boot.js";

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
/** The repo's top-level shape. A repo we cannot list is still worth describing from its key files, so a failure here is a log line and an empty tree. */
async function readTree(project: Project, fullName: string): Promise<string[]> {
  try {
    return await project.repo.list("");
  } catch (err) {
    console.error(
      `[floor] Failed to fetch tree for ${fullName}: ${errorMessage(err)}`,
    );

    return [];
  }
}

/** The files that describe a repo's conventions. Fetched together and missing ones skipped — most repos have only some of them, and an absent CLAUDE.md is the normal case this context exists to fix. */
async function readKeyFiles(
  project: Project,
  fullName: string,
): Promise<Record<string, string>> {
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

  return files;
}

/** Up to three source files, so the model sees how this repo actually writes code rather than only how it documents itself. Directories are tried in order and the walk stops at three. */
async function readSamples(
  project: Project,
  fullName: string,
): Promise<Record<string, string>> {
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

  return samples;
}

export async function fetchRepoContext(fullName: string): Promise<RepoContext> {
  const [owner, repo] = fullName.split("/");

  enforceTrue(
    owner && repo,
    Error,
    `Invalid repo full_name: "${fullName}". Expected "owner/repo" format.`,
  );
  const project = await projectFor(fullName);
  const [tree, files, samples] = await Promise.all([
    readTree(project, fullName),
    readKeyFiles(project, fullName),
    readSamples(project, fullName),
  ]);

  return { tree, files, samples };
}
