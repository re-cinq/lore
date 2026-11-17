import { describe, it, expect } from "vitest";
import type { SeedDeps, PipelineText } from "../floor/seed-floor-pipelines.js";
import type { Pipeline } from "@re-cinq/floor-pipeline";

describe("packLoader", () => {
  it("computes agent overlays with extensions and preserves variants", async () => {
    // @ts-expect-error testing missing module behavior
    const { packLoader } = await import("./pack-loader.js");
    
    const shippedPipeline: Pipeline = {
      files: {},
      stations: [],
      schedules: [],
      archive: { lines: [], stations: [], agentDefinitions: [], schedules: [] },
      agentDefinitions: [
        {
          id: "agent-one",
          body: {
            settings: { prompt: "Shipped prompt." },
            variants: { "github.com/re-cinq/test": { timeoutMinutes: 30 } }
          }
        },
        {
          id: "agent-two",
          body: {
            settings: { prompt: "Shipped prompt two." }
          }
        },
        {
          id: "agent-three",
          body: {
            settings: { prompt: "Untouched prompt." }
          }
        }
      ]
    };

    let importedPipeline: Pipeline | undefined;

    const baseDeps: SeedDeps = {
      files: async () => [],
      env: {},
      heldAgentDefinitions: async () => ["agent-one", "agent-two", "agent-three"],
      importPipeline: async (pipeline: Pipeline) => {
        importedPipeline = pipeline;

        return [];
      }
    };

    const packFiles: PipelineText[] = [
      { name: "agent-one.extra.md", text: "Pack extension." },
      { name: "agent-two.md", text: "---\n---\nPack replacement." }
    ];

    const loaderDeps = packLoader(baseDeps, packFiles);
    
    await loaderDeps.importPipeline(shippedPipeline);

    expect(importedPipeline?.agentDefinitions).toMatchObject([
      {
        id: "agent-one",
        body: {
          settings: { prompt: "Shipped prompt.\n\nPack extension." },
          variants: { "github.com/re-cinq/test": { timeoutMinutes: 30 } }
        }
      },
      {
        id: "agent-two",
        body: { settings: { prompt: "Pack replacement." } }
      },
      {
        id: "agent-three",
        body: { settings: { prompt: "Untouched prompt." } }
      }
    ]);
  });
});
