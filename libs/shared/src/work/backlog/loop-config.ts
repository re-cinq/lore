// Where the implementation loop keeps a ticket's definition of done on its branch: `.lore/dod.md`, unless the repository's `.lore/loop.yml` names a path its rules let Lore write (specs/implementation-loop FR6).
import { parse as parseYaml } from "yaml";
import { enforceTrue } from "../../lib/enforce.js";

export const LOOP_CONFIG_PATH = ".lore/loop.yml";
export const DEFAULT_DOD_PATH = ".lore/dod.md";

/** The definition-of-done path the repository's loop config names, or the default when there is no config or it names none. A path that leaves the repository or is not markdown is refused. */
export function dodPathOf(loopConfig: string | null): string {
  const named = loopConfig === null ? undefined : namedDodPath(loopConfig);

  if (named === undefined || named === null) {
    return DEFAULT_DOD_PATH;
  }
  enforceTrue(
    isRepoMarkdownPath(named),
    Error,
    `${LOOP_CONFIG_PATH}: dod_path must be a relative path to a .md file inside the repository, not ${JSON.stringify(named)}`,
  );

  return named;
}

function namedDodPath(loopConfig: string): unknown {
  const parsed: unknown = parseYaml(loopConfig);

  return typeof parsed === "object" && parsed !== null && "dod_path" in parsed
    ? parsed.dod_path
    : undefined;
}

function isRepoMarkdownPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.endsWith(".md") &&
    !path.startsWith("/") &&
    !path.split("/").includes("..")
  );
}
