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
import {
  definitionDrift,
  shippedAgentPrompts,
  withAgentPrompts,
  type AgentPrompts,
  type DefinitionDrift,
} from "@re-cinq/lore-shared/project/agents/agent-prompts.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { floorClientFrom } from "@re-cinq/lore-shared/floor/floor-client.js";
import type { Pool } from "pg";
import { PgAgentDefs } from "@re-cinq/lore-shared/project/agents/agent-defs-pg.js";
import type { AgentDefinition } from "@re-cinq/lore-shared/project/agents/agent-defs-port.js";

export interface PipelineText {
  name: string;
  text: string;
}

export interface SeedDeps {
  files(): Promise<PipelineText[]>;
  env: Record<string, string | undefined>;
  /** Each agent definition's stored prompt and settings, which the floor is handed in place of the pipeline file's. */
  agentSettings(): Promise<AgentPrompts>;
  /** What the floor holds for these agent definitions, read back after the put. */
  heldAgentDefinitions(
    ids: string[],
  ): Promise<
    Array<{ id: string; body: { settings?: Record<string, unknown> } }>
  >;
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

/** A shipped pipeline file as the floor is given it: the environment filled in, and each agent's prompt and settings taken from what is stored for it. */
export function pipelineOfText(
  yamlText: string,
  env: Record<string, string | undefined>,
  settings: AgentPrompts = shippedAgentPrompts(),
): Pipeline {
  return pipelineOf(
    withAgentPrompts(
      readPipelineFile(withEnvironment(yamlText, env)),
      settings,
    ),
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
  /** The agent definitions the floor holds differently from what is stored, read back after the put. */
  drift: DefinitionDrift[];
}

/** Puts every shipped pipeline, every time. A version is its content, so a definition the floor already holds is left exactly as it is and an edit made on the floor since stays the latest; only a file that CHANGED here becomes a new version. A file the floor refuses is reported and the rest are still put: one unshippable file froze four pipelines for a day when a single throw ended the pass. */
export async function seedFloorPipelines(deps: SeedDeps): Promise<Seeded> {
  const [files, settings] = await Promise.all([
    deps.files(),
    deps.agentSettings(),
  ]);
  const seeded: Seeded = { changed: [], failed: [], drift: [] };
  const named = new Set<string>();

  for (const file of files) {
    await putOne({ deps, settings, named }, file, seeded);
  }

  return {
    ...seeded,
    changed: [...new Set(seeded.changed)],
    drift: await driftAfterPut(deps, settings, [...named]),
  };
}

interface SeedPass {
  deps: SeedDeps;
  settings: AgentPrompts;
  /** Every agent definition a pipeline put names, gathered for the read-back. */
  named: Set<string>;
}

// Only the definitions a pipeline runs are compared: a stored row nothing runs is not the floor's to hold.
async function driftAfterPut(
  deps: SeedDeps,
  settings: AgentPrompts,
  named: string[],
): Promise<DefinitionDrift[]> {
  const ran = new Map([...settings].filter(([name]) => named.includes(name)));

  return named.length === 0
    ? []
    : definitionDrift(ran, await deps.heldAgentDefinitions(named));
}

async function putOne(
  { deps, settings, named }: SeedPass,
  file: PipelineText,
  { changed, failed }: Seeded,
): Promise<void> {
  try {
    const pipeline = pipelineOfText(file.text, deps.env, settings);
    const puts = await deps.importPipeline(pipeline);

    pipeline.agentDefinitions.forEach((agent) => named.add(agent.id));

    changed.push(...puts.filter((put) => put.changed).map(putName));
  } catch (cause) {
    failed.push({ name: file.name, reason: reasonOf(cause) });
  }
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

/** The floor seed lore-api runs: the org rows of lore.agent_definitions, seeded from the md files just before, are what each agent is handed; with no database the md files are read directly. */
export function productionSeedDeps(
  pool: Pool | null,
  env: Record<string, string | undefined> = process.env,
): SeedDeps {
  const floor = floorAccessOf(env);

  return {
    env,
    files: readFloorPipelineFiles,
    agentSettings: async () =>
      pool
        ? storedAgentSettings(await new PgAgentDefs(pool).list(""))
        : shippedAgentPrompts(),
    importPipeline: (pipeline) => importPipeline(floor, pipeline),
    heldAgentDefinitions: (ids) => heldOnFloor(env, ids),
  };
}

/** The org rows as the floor seed reads them, by definition name. */
export function storedAgentSettings(rows: AgentDefinition[]): AgentPrompts {
  return new Map(
    rows.map((row) => [
      row.name,
      {
        prompt: row.prompt,
        model: row.model,
        timeout_minutes: row.timeout_minutes,
        image: row.image,
        config: row.config,
      },
    ]),
  );
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

type HeldDefinition = {
  id: string;
  body: { settings?: Record<string, unknown> };
};

async function heldOnFloor(
  env: Record<string, string | undefined>,
  ids: string[],
): Promise<HeldDefinition[]> {
  const definitions = floorClientFrom(env).agentDefinitions;
  const rows = await Promise.all(ids.map((id) => definitions.get(id)));

  // An id the floor does not hold reads back as nothing, which the drift reports.
  return rows.flatMap((row) =>
    row ? [{ id: row.id, body: { settings: { ...row.body.settings } } }] : [],
  );
}
