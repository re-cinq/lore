import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pipelineOf, readPipelineFile } from "@re-cinq/floor-pipeline";
import {
  seedFloorPipelines,
  withEnvironment,
  type SeedDeps,
} from "./seed-floor-pipelines.js";

const FIXED_ENV = {
  LORE_AGENT_IMAGE: "ghcr.io/re-cinq/agent:1",
  LORE_SKILLS_URL: "https://skills.example",
  LORE_MCP_URL: "https://mcp.example/mcp",
};

const PIPELINES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../libs/assembly-lines/src/floor-pipelines",
);

function realFiles() {
  return readdirSync(PIPELINES_DIR)
    .filter((name) => name.endsWith(".yaml"))
    .map((name) => ({
      name,
      text: readFileSync(path.join(PIPELINES_DIR, name), "utf-8"),
    }));
}

function fakeFloor(held: string[]) {
  const imported: string[] = [];
  const deps: SeedDeps = {
    files: async () => [
      { name: "a.yaml", text: "line:\n  id: code-review\n" },
      { name: "b.yaml", text: "line:\n  id: lore-run-settled\n" },
    ],
    env: {},
    importPipeline: async (pipeline) => {
      const id = pipeline.line?.id ?? "";

      imported.push(id);

      return [{ kind: "assembly-lines", id, changed: !held.includes(id) }];
    },
  };

  return { deps, imported };
}

describe("withEnvironment", () => {
  it("fills ${LORE_MCP_URL} with the value given", () => {
    expect(withEnvironment("url: ${LORE_MCP_URL}", FIXED_ENV)).toEqual(
      "url: https://mcp.example/mcp",
    );
  });

  it("throws naming LORE_AGENT_IMAGE when it is unset", () => {
    expect(() => withEnvironment("image: ${LORE_AGENT_IMAGE}", {})).toThrow(
      new Error("LORE_AGENT_IMAGE is not set, and a pipeline names it"),
    );
  });
});

describe("seedFloorPipelines", () => {
  it("puts both pipelines and reports only lore-run-settled as changed when the floor holds code-review as written", async () => {
    const { deps, imported } = fakeFloor(["code-review"]);

    expect(await seedFloorPipelines(deps)).toEqual([
      "assembly-lines/lore-run-settled",
    ]);
    expect(imported).toEqual(["code-review", "lore-run-settled"]);
  });

  it("reports both lines as changed on a floor that holds neither", async () => {
    const { deps } = fakeFloor([]);

    expect(await seedFloorPipelines(deps)).toEqual([
      "assembly-lines/code-review",
      "assembly-lines/lore-run-settled",
    ]);
  });

  it("reports nothing changed when the floor holds every pipeline as written", async () => {
    const { deps } = fakeFloor(["code-review", "lore-run-settled"]);

    expect(await seedFloorPipelines(deps)).toEqual([]);
  });

  it("names a station two pipelines share once", async () => {
    const { deps } = fakeFloor([]);
    const shared = { kind: "stations", id: "post-review", changed: true };

    deps.importPipeline = () => Promise.resolve([shared]);

    expect(await seedFloorPipelines(deps)).toEqual(["stations/post-review"]);
  });
});

describe("the pipeline files shipped in libs/assembly-lines", () => {
  const pipelines = realFiles().map((file) =>
    pipelineOf(readPipelineFile(withEnvironment(file.text, FIXED_ENV))),
  );

  it("declare the lines code-review, code-review-recheck, code-review-reply, feature-planning and lore-run-settled", () => {
    expect(pipelines.map((pipeline) => pipeline.line?.id).sort()).toEqual([
      "code-review",
      "code-review-recheck",
      "code-review-reply",
      "feature-planning",
      "lore-run-settled",
    ]);
  });

  it("give every agent definition a non-empty prompt", () => {
    const prompts = pipelines
      .flatMap((pipeline) => pipeline.agentDefinitions)
      .map(
        (definition) => (definition.body.settings as { prompt: string }).prompt,
      );

    expect(prompts.every((prompt) => prompt.length > 0)).toBe(true);
  });
});
