import {
  pipelineOf,
  readPipelineFile,
  type Pipeline,
} from "@re-cinq/floor-pipeline";
import { pipelineProblems } from "@re-cinq/lore-assembly-lines";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { withEnvironment } from "../floor/seed-floor-pipelines.js";
import type { PackFile } from "./fetch-pack.js";
import type { OverlayAgent, PackOverlayInput } from "./pack-agents.js";
import { pipelineFolderOf } from "./pack-paths.js";
import { attempt, type Refusal } from "./pack-refusal.js";

const NEW_FILE_NAME = "assembly-line.yaml";

interface PipelineFile extends PackFile {
  folder: string;
}

/** The pipelines the pack sets, its own and its versions of the lines Lore ships. Each names its agents only: the agents are put on their own, so a pipeline is imported with no agent definitions of its own. */
export function pipelinesOverlay(
  input: PackOverlayInput,
  packAgents: ReadonlyMap<string, OverlayAgent>,
) {
  const pipelines: Pipeline[] = [];
  const refused: Refusal[] = [];

  const files = pipelineFilesOf(input.files);

  for (const file of files) {
    const result = attempt(file.path, () => {
      enforceNotTwice(file, files);

      return pipelineOfFile(file, input, packAgents);
    });

    if ("refusal" in result) {
      refused.push(result.refusal);
      continue;
    }
    pipelines.push(result.made);
  }

  return { pipelines, refused };
}

function pipelineFilesOf(files: readonly PackFile[]): PipelineFile[] {
  return files
    .flatMap((file) => {
      const folder = pipelineFolderOf(file.path);

      return folder ? [{ ...file, folder }] : [];
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** The file under the old name gives way when the folder holds the new one too. */
function enforceNotTwice(file: PipelineFile, files: PipelineFile[]): void {
  const holdsNewName = files.some(
    (other) =>
      other.folder === file.folder && other.path.endsWith(NEW_FILE_NAME),
  );

  enforceTrue(
    !holdsNewName || file.path.endsWith(NEW_FILE_NAME),
    Error,
    `the folder ${file.folder} holds its line twice: ${NEW_FILE_NAME} is read, so remove pipeline.yaml`,
  );
}

function pipelineOfFile(
  file: PipelineFile,
  { shipped, env }: PackOverlayInput,
  packAgents: ReadonlyMap<string, OverlayAgent>,
): Pipeline {
  const filled = withEnvironment(file.text, env);

  enforceNoProblems(filled, promptsOf(shipped.agents, packAgents));
  const pipeline = pipelineOf(readPipelineFile(filled));

  enforceTrue(
    pipeline.line?.id === file.folder,
    Error,
    `the folder ${file.folder} must hold the assembly line of that name, and its line is ${pipeline.line?.id}`,
  );

  return pipeline;
}

function enforceNoProblems(
  yamlText: string,
  prompts: ReturnType<typeof promptsOf>,
): void {
  const problems = pipelineProblems(yamlText, prompts);

  enforceTrue(
    problems.length === 0,
    Error,
    problems.map((problem) => problem.detail).join("; "),
  );
}

/** The prompts a pipeline can name: the shipped agents' and the pack's own. */
function promptsOf(
  shipped: PackOverlayInput["shipped"]["agents"],
  packAgents: ReadonlyMap<string, OverlayAgent>,
) {
  return new Map([
    ...[...shipped].map(([name, agent]) => [name, agent.prompt] as const),
    ...[...packAgents].map(
      ([name, agent]) => [name, agent.settings.prompt] as const,
    ),
  ]);
}
