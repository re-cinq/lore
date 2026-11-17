/** The layout of a pack: `<pipeline>/pipeline.yaml`, `<pipeline>/agents/<agent>.md` and `<pipeline>/agents/<agent>.extra.md`. */
const PIPELINE_FILE = /^([^/]+)\/pipeline\.yaml$/;
const AGENT_FILE = /^[^/]+\/agents\/([^/]+?)(\.extra)?\.md$/;

/** The pipeline folder a `pipeline.yaml` sits in. */
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

/** A markdown or YAML file inside a line folder: Lore reads it, or refuses it as a path it does not read. A file at the top, under `docs/` or under a dot folder is not the pack's. */
const LINE_FOLDER_FILE = /^(?!docs\/)[^./][^/]*\/.+\.(md|ya?ml)$/;

export function isPackFile(path: string): boolean {
  return LINE_FOLDER_FILE.test(path);
}

/** A path Lore applies: a pipeline or an agent file. */
export function isReadPath(path: string): boolean {
  return (
    pipelineFolderOf(path) !== undefined || agentFileOf(path) !== undefined
  );
}
