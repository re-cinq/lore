import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  pipelineOf,
  readPipelineFile,
  type Pipeline,
} from "@re-cinq/floor-pipeline";
import {
  pipelinesToSeed,
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

function pipelineOfLine(lineId: string): Pipeline {
  return pipelineOf(readPipelineFile(`line:\n  id: ${lineId}\n`));
}

function realFiles() {
  return readdirSync(PIPELINES_DIR)
    .filter((name) => name.endsWith(".yaml"))
    .map((name) => ({
      name,
      text: readFileSync(path.join(PIPELINES_DIR, name), "utf-8"),
    }));
}

function fakeFloor(existing: string[]) {
  const imported: string[] = [];
  const deps: SeedDeps = {
    files: async () => [
      { name: "a.yaml", text: "line:\n  id: code-review\n" },
      { name: "b.yaml", text: "line:\n  id: lore-run-settled\n" },
    ],
    env: {},
    lineExists: async (lineId) => existing.includes(lineId),
    importPipeline: async (pipeline) => {
      imported.push(pipeline.line?.id ?? "");
    },
  };

  return { deps, imported };
}

describe("pipelinesToSeed", () => {
  it("skips code-review when the floor already has it", () => {
    const pipelines = [
      pipelineOfLine("code-review"),
      pipelineOfLine("code-review-reply"),
    ];

    expect(
      pipelinesToSeed(pipelines, new Set(["code-review"])).map(
        (pipeline) => pipeline.line?.id,
      ),
    ).toEqual(["code-review-reply"]);
  });
});

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
  it("imports only lore-run-settled and returns its id when code-review exists", async () => {
    const { deps, imported } = fakeFloor(["code-review"]);

    expect(await seedFloorPipelines(deps)).toEqual(["lore-run-settled"]);
    expect(imported).toEqual(["lore-run-settled"]);
  });

  it("imports both lines when the floor has none", async () => {
    const { deps } = fakeFloor([]);

    expect(await seedFloorPipelines(deps)).toEqual([
      "code-review",
      "lore-run-settled",
    ]);
  });
});

describe("the four pipeline files shipped in libs/assembly-lines", () => {
  const pipelines = realFiles().map((file) =>
    pipelineOf(readPipelineFile(withEnvironment(file.text, FIXED_ENV))),
  );

  it("declare the lines code-review, code-review-recheck, code-review-reply and lore-run-settled", () => {
    expect(pipelines.map((pipeline) => pipeline.line?.id).sort()).toEqual([
      "code-review",
      "code-review-recheck",
      "code-review-reply",
      "lore-run-settled",
    ]);
  });

  it("give every agent definition a non-empty prompt", () => {
    const prompts = pipelines
      .flatMap((pipeline) => pipeline.agentDefinitions)
      .map(
        (definition) => (definition.body.settings as { prompt: string }).prompt,
      );

    expect(prompts.map((prompt) => prompt.length > 0)).toEqual([
      true,
      true,
      true,
    ]);
  });
});
