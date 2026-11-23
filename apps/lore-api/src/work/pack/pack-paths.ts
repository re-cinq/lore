/** The layout of a pack: `<line>/assembly-line.yaml` (`<line>/pipeline.yaml` is the same file under its old name), `<pipeline>/agents/<agent>.md`, `<pipeline>/agents/<agent>.extra.md` and `skills/<name>.md`. */
const RESERVED_FOLDERS = ["skills", "agent-skills"];

const LINE_FOLDER = `(?!(?:${RESERVED_FOLDERS.join("|")})/)[^/]+`;
const PIPELINE_FILE = new RegExp(
  `^(${LINE_FOLDER})/(assembly-line|pipeline)\\.yaml$`,
);
const AGENT_FILE = new RegExp(
  `^${LINE_FOLDER}/agents/([^/]+?)(\\.extra)?\\.md$`,
);
const SKILL_FILE = /^skills\/([^/]+)\.md$/;

/** The line folder an `assembly-line.yaml`, or a `pipeline.yaml`, sits in. */
export function pipelineFolderOf(path: string): string | undefined {
  return PIPELINE_FILE.exec(path)?.[1];
}

export function agentFileOf(
  path: string,
): { agent: string; isExtension: boolean } | undefined {
  const match = AGENT_FILE.exec(path);

  return match
    ? { agent: match[1], isExtension: Boolean(match[2]) }
    : undefined;
}

/** The name a `skills/<name>.md` file carries, valid or not. */
export function skillFileOf(path: string): string | undefined {
  return SKILL_FILE.exec(path)?.[1];
}

/** A markdown or YAML file inside a folder: Lore reads it, or refuses it as a path it does not read. A file at the top, under `docs/`, under `agent-skills/` or under a dot folder is not the pack's. */
const PACK_FOLDER_FILE =
  /^(?!docs\/|agent-skills\/)[^./][^/]*\/.+\.(md|ya?ml)$/;

export function isPackFile(path: string): boolean {
  return PACK_FOLDER_FILE.test(path);
}

/** A path Lore applies: a pipeline, an agent file or a skill. */
export function isReadPath(path: string): boolean {
  return (
    pipelineFolderOf(path) !== undefined ||
    agentFileOf(path) !== undefined ||
    skillFileOf(path) !== undefined
  );
}
