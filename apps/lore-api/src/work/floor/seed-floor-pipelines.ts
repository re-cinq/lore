import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
  importPipeline,
  pipelineOf,
  readPipelineFile,
  type Pipeline,
  type Put,
} from "@re-cinq/floor-pipeline";
import { withAgentPrompts } from "@re-cinq/lore-shared/project/agents/agent-prompts.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

export interface PipelineText {
  name: string;
  text: string;
}

export interface SeedDeps {
  files(): Promise<PipelineText[]>;
  env: Record<string, string | undefined>;
  /** Puts a pipeline's definitions and answers for each whether the floor already held that content. */
  importPipeline(pipeline: Pipeline): Promise<Put[]>;
}

const PLACEHOLDER = /\$\{([A-Z][A-Z0-9_]*)\}/g;

export function withEnvironment(
  yamlText: string,
  env: Record<string, string | undefined>,
): string {
  return yamlText.replace(PLACEHOLDER, (_placeholder, name: string) => {
    const value = env[name];

    enforceTrue(value, Error, `${name} is not set, and a pipeline names it`);

    return value;
  });
}

/** A shipped pipeline file as the floor is given it: the environment filled in, and each agent's prompt read from its agent-defaults .md. */
export function pipelineOfText(
  yamlText: string,
  env: Record<string, string | undefined>,
): Pipeline {
  return pipelineOf(
    withAgentPrompts(readPipelineFile(withEnvironment(yamlText, env))),
  );
}

/** Puts every shipped pipeline, every time. A version is its content, so a definition the floor already holds is left exactly as it is and an edit made on the floor since stays the latest; only a file that CHANGED here becomes a new version. Answers what changed, as `kind/id`. */
export async function seedFloorPipelines(deps: SeedDeps): Promise<string[]> {
  const files = await deps.files();
  const changed: string[] = [];

  for (const file of files) {
    const puts = await deps.importPipeline(pipelineOfText(file.text, deps.env));

    changed.push(...puts.filter((put) => put.changed).map(putName));
  }

  return [...new Set(changed)];
}

function putName(put: Put): string {
  return `${put.kind}/${put.id}`;
}

export function productionSeedDeps(
  env: Record<string, string | undefined> = process.env,
): SeedDeps {
  const floor = floorAccessOf(env);

  return {
    env,
    files: readFloorPipelineFiles,
    importPipeline: (pipeline) => importPipeline(floor, pipeline),
  };
}

function floorAccessOf(env: Record<string, string | undefined>) {
  const access = {
    url: env.FLOOR_API_URL ?? "",
    token: env.FLOOR_SERVICE_TOKEN ?? "",
  };

  enforceTrue(
    access.url && access.token,
    Error,
    "FLOOR_API_URL and FLOOR_SERVICE_TOKEN must both be set to seed the floor",
  );

  return access;
}

async function readFloorPipelineFiles(): Promise<PipelineText[]> {
  const dir = floorPipelinesDir();
  const names = (await readdir(dir)).filter((name) => name.endsWith(".yaml"));

  return Promise.all(
    names.map(async (name) => ({
      name,
      text: await readFile(path.join(dir, name), "utf-8"),
    })),
  );
}

// Sits beside the compiled index of the assembly-lines package, where its build copies the folder.
function floorPipelinesDir(): string {
  const entry = createRequire(import.meta.url).resolve(
    "@re-cinq/lore-assembly-lines",
  );

  return path.join(path.dirname(entry), "floor-pipelines");
}
