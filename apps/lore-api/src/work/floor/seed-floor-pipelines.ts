import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
  importPipeline,
  pipelineOf,
  readPipelineFile,
  type Pipeline,
} from "@re-cinq/floor-pipeline";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";

export interface PipelineText {
  name: string;
  text: string;
}

export interface SeedDeps {
  files(): Promise<PipelineText[]>;
  env: Record<string, string | undefined>;
  lineExists(lineId: string): Promise<boolean>;
  importPipeline(pipeline: Pipeline): Promise<void>;
}

const PLACEHOLDER = /\$\{([A-Z][A-Z0-9_]*)\}/g;

export function pipelinesToSeed(
  pipelines: Pipeline[],
  existingLineIds: ReadonlySet<string>,
): Pipeline[] {
  return pipelines.filter(
    (pipeline) => !existingLineIds.has(pipeline.line?.id ?? ""),
  );
}

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

export async function seedFloorPipelines(deps: SeedDeps): Promise<string[]> {
  const files = await deps.files();
  const pipelines = files.map((file) =>
    pipelineOf(readPipelineFile(withEnvironment(file.text, deps.env))),
  );
  const existing = await Promise.all(
    pipelines.map(async (pipeline) =>
      (await deps.lineExists(pipeline.line?.id ?? ""))
        ? (pipeline.line?.id ?? "")
        : "",
    ),
  );
  const missing = pipelinesToSeed(pipelines, new Set(existing));

  await Promise.all(missing.map((pipeline) => deps.importPipeline(pipeline)));

  return missing.map((pipeline) => pipeline.line?.id ?? "");
}

export function productionSeedDeps(
  env: Record<string, string | undefined> = process.env,
): SeedDeps {
  const floor = { url: env.FLOOR_API_URL ?? "", token: env.FLOOR_SERVICE_TOKEN ?? "" };

  enforceTrue(
    floor.url && floor.token,
    Error,
    "FLOOR_API_URL and FLOOR_SERVICE_TOKEN must both be set to seed the floor",
  );

  return {
    env,
    files: readFloorPipelineFiles,
    lineExists: async (lineId) =>
      (await floorClient().lines.get(lineId)) !== null,
    importPipeline: async (pipeline) => {
      await importPipeline(floor, pipeline);
    },
  };
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
