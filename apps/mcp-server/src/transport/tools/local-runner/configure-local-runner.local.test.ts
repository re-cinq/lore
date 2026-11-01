import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { registerConfigureLocalRunnerTool } from "./configure-local-runner.local.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import {
  createTestMachine,
  readLoreFile,
  resetMachine,
  writeLoreFile,
} from "./shared/test-machine.js";

const machine = createTestMachine();
const configure = toolHandlers(registerConfigureLocalRunnerTool, "full")[
  "lore_configure_local_runner"
];
const STORED = {
  enabled: true,
  max_concurrent: 2,
  repos: ["acme/widget"],
  task_types: ["runbook"],
  model: "claude-sonnet-4-6",
};

beforeEach(() => {
  vi.stubEnv("HOME", machine.home);
});

afterEach(() => {
  resetMachine(machine);
  vi.unstubAllEnvs();
});

describe("lore_configure_local_runner", () => {
  it("returns the stored config unchanged when called with no arguments", async () => {
    writeLoreFile(machine, "local-runner.json", STORED);

    const result = await configure({});

    expect(JSON.parse(result.content[0].text)).toEqual(STORED);
  });

  it("writes every given field over the stored config", async () => {
    writeLoreFile(machine, "local-runner.json", STORED);
    const updated = {
      enabled: true,
      max_concurrent: 4,
      repos: ["acme/gadget"],
      task_types: ["onboard"],
      model: "claude-opus-4-6",
    };

    const result = await configure({
      max_concurrent: 4,
      repos: ["acme/gadget"],
      task_types: ["onboard"],
      model: "claude-opus-4-6",
    });

    expect({
      text: result.content[0].text,
      stored: readLoreFile(machine, "local-runner.json"),
    }).toEqual({
      text: `Config updated:\n${JSON.stringify(updated, null, 2)}`,
      stored: updated,
    });
  });

  it("keeps the other fields when only max_concurrent 3 is given", async () => {
    writeLoreFile(machine, "local-runner.json", STORED);

    await configure({ max_concurrent: 3 });

    expect(readLoreFile(machine, "local-runner.json")).toEqual({
      ...STORED,
      max_concurrent: 3,
    });
  });

  it("reports the error when the config path cannot be written", async () => {
    mkdirSync(join(machine.loreDir, "local-runner.json"));

    const result = await configure({ model: "claude-opus-4-6" });

    expect(result.content[0].text).toMatch(/^Error: EISDIR/);
  });
});
