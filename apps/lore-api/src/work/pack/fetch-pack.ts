import { isPackFile } from "./pack-paths.js";
import type { PackConfig } from "./pack-config.js";

/** What the pack repository answers, whichever git host holds it. */
export interface PackReader {
  headCommit(repo: string, ref: string | undefined): Promise<string>;
  tree(repo: string, commit: string): Promise<string[]>;
  fileText(repo: string, path: string, commit: string): Promise<string>;
}

export interface PackFile {
  path: string;
  text: string;
}

export interface FetchedPack {
  commit: string;
  files: PackFile[];
}

export async function fetchPack(
  reader: PackReader,
  config: PackConfig,
): Promise<FetchedPack> {
  const commit = await reader.headCommit(config.repo, config.ref);
  const paths = await reader.tree(config.repo, commit);
  const files = await Promise.all(
    paths
      .filter((path) => isPackFile(path))
      .map(async (path) => ({
        path,
        text: await reader.fileText(config.repo, path, commit),
      })),
  );

  return { commit, files };
}
