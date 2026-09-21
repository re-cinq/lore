import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadAgentDefaults } from "./agent-defaults-files.js";
import { AgentDefsYaml } from "./agent-defs-yaml.js";
import { parseTaskTypesFile } from "../../../domain/task-types/task-types-config.js";
import { readTaskTypesSource } from "../../../lib/task-types-source.js";

const TASK_TYPES = resolve(
  import.meta.dirname,
  "../../../../../../scripts/task-types.yaml",
);

describe("loadAgentDefaults", () => {
  it("loads the 21 shipped agents and 5 def- stations, each named after its file", () => {
    const defaults = loadAgentDefaults();

    expect({
      count: defaults.length,
      review: defaults.find((row) => row.name === "review")?.execution_mode,
      station: defaults.find((row) => row.name === "def-validate")
        ?.execution_mode,
    }).toEqual({ count: 26, review: "claude-code", station: "station" });
  });

  // Temporary (B2 deletes it with the yaml): the files must resolve exactly as the yaml fallback does today.
  it("resolves every claude-code agent exactly as the task-types.yaml fallback does", async () => {
    const fromYaml = await new AgentDefsYaml(TASK_TYPES).list("re-cinq/lore");
    const fromFiles = loadAgentDefaults().filter(
      (row) => row.execution_mode !== "station",
    );

    expect(fromFiles).toEqual(fromYaml);
  });

  it("carries every task-types.yaml station recipe onto its def- row", () => {
    const { stations } = parseTaskTypesFile(readTaskTypesSource(TASK_TYPES));
    const expected = Object.entries(stations).map(([type, recipe]) => ({
      name: `def-${type}`,
      timeout_minutes: recipe.timeout_minutes,
      config: {
        command: recipe.command,
        ...(recipe.env ? { env: recipe.env } : {}),
        ...(recipe.pod_labels ? { pod_labels: recipe.pod_labels } : {}),
        ...(recipe.needs_model ? { needs_model: recipe.needs_model } : {}),
      },
    }));
    const fromFiles = loadAgentDefaults()
      .filter((row) => row.execution_mode === "station")
      .map(({ name, timeout_minutes, config }) => ({
        name,
        timeout_minutes,
        config,
      }));

    expect(fromFiles).toEqual(expect.arrayContaining(expected));
  });
});
