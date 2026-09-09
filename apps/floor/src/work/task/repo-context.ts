import type { Project } from "@re-cinq/lore-shared";
import { errorMessage } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { projectFor } from "../../outbound/project-boot.js";
import {
  KEY_FILES,
  SAMPLE_DIRS,
  type RepoContext,
} from "@re-cinq/lore-shared/repo-context.js";

/** One sample file's first 200 lines, or null when it is missing or unreadable — a single bad file must not lose the whole sample walk. */
async function readSampleFile(
  project: Project,
  fullName: string,
  entryPath: string,
): Promise<string | null> {
  try {
    const content = await project.repo.read(entryPath);

    return content === null
      ? null
      : content.split("\n").slice(0, 200).join("\n");
  } catch (err) {
    console.error(
      `[floor] Error fetching sample ${fullName}/${entryPath}: ${errorMessage(err)}`,
    );

    return null;
  }
}

/** Reads up to the 3-sample cap from one directory's entries (first 200 lines each); per-file read failures are logged and skipped. */
async function sampleDirEntries(
  project: Project,
  fullName: string,
  { dir, entries }: { dir: string; entries: string[] },
  samples: Record<string, string>,
): Promise<void> {
  for (const entryName of entries) {
    if (Object.keys(samples).length >= 3) {
      return;
    }
    const entryPath = `${dir}/${entryName}`;
    const content = await readSampleFile(project, fullName, entryPath);

    if (content !== null) {
      samples[entryPath] = content;
    }
  }
}

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

/** One convention file, or null when absent or unreadable. */
async function readKeyFile(
  project: Project,
  fullName: string,
  path: string,
): Promise<string | null> {
  try {
    return await project.repo.read(path);
  } catch (err) {
    console.error(
      `[floor] Error fetching ${fullName}/${path}: ${errorMessage(err)}`,
    );

    return null;
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
      const content = await readKeyFile(project, fullName, path);

      if (content !== null) {
        files[path] = content;
      }
    }),
  );

  return files;
}

/** One sample directory's entries, or null when it cannot be listed (most repos have only a couple of the well-known directories). */
async function listSampleDir(
  project: Project,
  fullName: string,
  dir: string,
): Promise<string[] | null> {
  try {
    return await project.repo.list(dir);
  } catch (err) {
    console.error(
      `[floor] Error listing ${fullName}/${dir}: ${errorMessage(err)}`,
    );

    return null;
  }
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
    const entries = await listSampleDir(project, fullName, dir);

    if (entries) {
      await sampleDirEntries(project, fullName, { dir, entries }, samples);
    }
  }

  return samples;
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
  const [tree, files, samples] = await Promise.all([
    readTree(project, fullName),
    readKeyFiles(project, fullName),
    readSamples(project, fullName),
  ]);

  return { tree, files, samples };
}
