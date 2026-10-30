import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { isFloorProblem } from "@re-cinq/floor-client";
import {
  importPipeline,
  pipelineOf,
  readPipelineFile,
  type Pipeline,
  type Put,
} from "@re-cinq/floor-pipeline";
import { withAgentPrompts } from "@re-cinq/lore-shared/project/agents/agent-prompts.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { floorClientFrom } from "@re-cinq/lore-shared/floor/floor-client.js";

export interface PipelineText {
  name: string;
  text: string;
}

export interface SeedDeps {
  files(): Promise<PipelineText[]>;
  env: Record<string, string | undefined>;
  /** The agent definitions the floor already holds: those are saved there and never re-seeded from a file. */
  heldAgentDefinitions(): Promise<string[]>;
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

export interface SeedFailure {
  name: string;
  reason: string;
}

export interface Seeded {
  /** What became a new version, as `kind/id`. */
  changed: string[];
  failed: SeedFailure[];
}

/** Puts every shipped pipeline, every time. A version is its content, so a definition the floor already holds is left exactly as it is and an edit made on the floor since stays the latest; only a file that CHANGED here becomes a new version. An agent definition is seeded only when the floor holds none of that name: once there, it is edited on the floor (#3995), and a changed file must not overwrite a saved prompt or a repository's variant. A file the floor refuses is reported and the rest are still put: one unshippable file froze four pipelines for a day when a single throw ended the pass. */
export async function seedFloorPipelines(deps: SeedDeps): Promise<Seeded> {
  const files = await deps.files();
  const held = new Set(await deps.heldAgentDefinitions());
  const tally: Seeded = { changed: [], failed: [] };

  for (const file of files) {
    await putOne(deps, held, file, tally);
  }

  return { changed: [...new Set(tally.changed)], failed: tally.failed };
}

async function putOne(
  deps: SeedDeps,
  held: ReadonlySet<string>,
  file: PipelineText,
  tally: Seeded,
): Promise<void> {
  try {
    const pipeline = unseededOnly(pipelineOfText(file.text, deps.env), held);
    const puts = await deps.importPipeline(pipeline);

    tally.changed.push(...puts.filter((put) => put.changed).map(putName));
  } catch (cause) {
    tally.failed.push({ name: file.name, reason: reasonOf(cause) });
  }
}

function unseededOnly(pipeline: Pipeline, held: ReadonlySet<string>): Pipeline {
  const { agentDefinitions } = pipeline;

  return {
    ...pipeline,
    agentDefinitions: agentDefinitions.filter((named) => !held.has(named.id)),
  };
}

// A 400's title alone ("invalid line body") hid the two unseeded binds that kept feature-planning off the floor for four days (#3487): the floor's problem list rides along.
function reasonOf(cause: unknown): string {
  if (isFloorProblem(cause) && cause.errors?.length) {
    return `${cause.message}: ${cause.errors.join("; ")}`;
  }

  return cause instanceof Error ? cause.message : String(cause);
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
    heldAgentDefinitions: async () =>
      (await floorClientFrom(env).agentDefinitions.list()).map((row) => row.id),
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

export async function readFloorPipelineFiles(): Promise<PipelineText[]> {
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
