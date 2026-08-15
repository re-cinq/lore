import { describe, it, expect } from "vitest";
import { buildRegistry, withExtra } from "./registry.js";
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
    const missing = producibleEventNames().filter(
      (name) => !registry.has(name),
    );

    expect(missing).toEqual([]);
  });

  it("maps every registered name to a defined handler", () => {
    for (const [name, handler] of buildRegistry()) {
      expect(handler, `handler for ${name}`).toBeTypeOf("function");
    }
  });

  it("registers both run-event spellings onto the same handlers (rollout shim)", () => {
    // The emitters ship the legacy spelling until every Floor handles the new
    // one; the registry must answer to both, with one handler each, or the
    // flip release dead-letters whichever side moves first.
    const registry = buildRegistry();

    expect(registry.get("assembly_run.start")).toBe(
      registry.get("assembly_line.start"),
    );
    expect(registry.get("assembly_run.resume")).toBe(
      registry.get("assembly_line.resume"),
    );
    expect(registry.get("assembly_run.start")).toBeTypeOf("function");
    expect(registry.get("assembly_run.resume")).toBeTypeOf("function");
  });

  it("routes the post-ingest validate event through the detect tick (one substrate, FR5)", () => {
    // The same production handler serves the weekly cron and the post-ingest
    // trigger: params.repo narrows it to the one repo, and the validate core
    // runs in the detect station pod either way — never inline in the Floor.
    expect(buildRegistry().get("internal.ingest.spec_coverage_validate")).toBe(
      buildRegistry().get("cron.spec_coverage_validate.tick"),
    );
  });
});

describe("withExtra", () => {
  it("runs the primary then every secondary in order", async () => {
    const seen: string[] = [];
    const composed = withExtra(
      async () => {
        seen.push("primary");
      },
      async () => {
        seen.push("extra-1");
      },
      async () => {
        seen.push("extra-2");
      },
    );

    await composed({});

    expect(seen).toEqual(["primary", "extra-1", "extra-2"]);
  });

  it("propagates a primary throw (keeps its retry semantics)", async () => {
    const composed = withExtra(
      async () => {
        throw new Error("primary boom");
      },
      async () => {},
    );

    await expect(composed({})).rejects.toThrow("primary boom");
  });

  it("swallows a secondary throw so it never breaks the primary", async () => {
    let primaryRan = false;
    const composed = withExtra(
      async () => {
        primaryRan = true;
      },
      async () => {
        throw new Error("secondary boom");
      },
    );

    await expect(composed({})).resolves.toBeUndefined();
    expect(primaryRan).toBe(true);
  });
});
