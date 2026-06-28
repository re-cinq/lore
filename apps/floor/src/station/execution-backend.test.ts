import { describe, it, expect } from "vitest";
import {
  decideExecutionBackend,
  executionBackendForTask,
  repoBackendFromSettings,
} from "./execution-backend.js";

describe("repoBackendFromSettings", () => {
  it("reads dark_factory.execution.backend", () => {
    expect(repoBackendFromSettings({ dark_factory: { execution: { backend: "agent-cr" } } })).toBe("agent-cr");
  });
  it("is undefined when unset, malformed, or non-object", () => {
    expect(repoBackendFromSettings({ dark_factory: { execution: {} } })).toBeUndefined();
    expect(repoBackendFromSettings({ dark_factory: { execution: { backend: 1 } } })).toBeUndefined();
    expect(repoBackendFromSettings({})).toBeUndefined();
    expect(repoBackendFromSettings(null)).toBeUndefined();
  });
});

describe("executionBackendForTask", () => {
  const on = { LORE_AGENT_CR_BACKEND_ENABLED: "true" } as NodeJS.ProcessEnv;

  it("routes to agent-cr when both gates are on", () => {
    expect(executionBackendForTask({ repoBackend: "agent-cr", env: on })).toBe("agent-cr");
  });

  it("stays on loretask when the cluster gate is off", () => {
    expect(executionBackendForTask({ repoBackend: "agent-cr", env: {} as NodeJS.ProcessEnv })).toBe("loretask");
  });

  it("stays on loretask when the repo has not opted in", () => {
    expect(executionBackendForTask({ env: on })).toBe("loretask");
  });
});

describe("decideExecutionBackend", () => {
  it("routes to loretask when the cluster gate is off (even if the repo opted in)", () => {
    expect(decideExecutionBackend({ clusterEnabled: false, repoBackend: "agent-cr" })).toBe("loretask");
  });

  it("routes to loretask when the repo has not opted in", () => {
    expect(decideExecutionBackend({ clusterEnabled: true })).toBe("loretask");
    expect(decideExecutionBackend({ clusterEnabled: true, repoBackend: "loretask" })).toBe("loretask");
  });

  it("routes to agent-cr when both gates are on", () => {
    expect(decideExecutionBackend({ clusterEnabled: true, repoBackend: "agent-cr" })).toBe("agent-cr");
  });
});
