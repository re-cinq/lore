import { describe, it, expect } from "vitest";
import { buildRegistry } from "./registry.js";
import { GITHUB_EVENT_NAMES } from "../listeners/github-map.js";
import { AGENT_EVENT_NAMES } from "../listeners/k8s-map.js";
import { cronTickEventNames } from "../listeners/cron-emitters.js";

/**
 * Floor's own producers (the layer-1 listeners + cron emitters). mcp-server also
 * emits `internal.ingest.spec_coverage_validate`, which the registry covers but no
 * Floor listener produces — so this list is what Floor can put on the bus, and the
 * invariant is: every name here resolves to a handler, or the loop dead-letters it.
 */
function producibleEventNames(): string[] {
  return [
    ...GITHUB_EVENT_NAMES,
    ...AGENT_EVENT_NAMES,
    "internal.ingest.spec_trace", // ci-ingest-map + ci-tests-map
    "assembly_line.start", // project.assemblyLines.start() — worker + station backend
    ...cronTickEventNames(),
  ];
}

describe("buildRegistry", () => {
  it("registers a handler for every event name a Floor producer can emit", () => {
    const registry = buildRegistry();
    const missing = producibleEventNames().filter((name) => !registry.has(name));
    expect(missing).toEqual([]);
  });

  it("maps every registered name to a defined handler", () => {
    for (const [name, handler] of buildRegistry()) {
      expect(handler, `handler for ${name}`).toBeTypeOf("function");
    }
  });
});
