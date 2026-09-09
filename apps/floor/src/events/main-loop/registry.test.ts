import { describe, it, expect } from "vitest";
import { buildRegistry, withExtra } from "./registry.js";
import { RUN_START_EVENT } from "@re-cinq/lore-shared/project/assembly-runs/run-events.js";
import { GITHUB_EVENT_NAMES } from "@re-cinq/lore-shared/project/events/github-map.js";
import { AGENT_EVENT_NAMES } from "@re-cinq/lore-shared/project/events/k8s-map.js";
import { cronTickEventNames } from "../listeners/cron-emitters.js";

function producibleEventNames(): string[] {
  return [
    ...GITHUB_EVENT_NAMES,
    ...AGENT_EVENT_NAMES,
    "internal.ingest.spec_trace",
    RUN_START_EVENT,
    ...cronTickEventNames(),
  ];
}

describe("buildRegistry", () => {
  it("registers a handler for every event name a Floor producer can emit, reading RUN_START_EVENT from the constant so a writer flip can't drift undetected", () => {
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

  it("no longer answers to the pre-flip run-event spellings (shim deleted one retention window past the #1255 writer flip, #1272)", () => {
    const registry = buildRegistry();

    expect(registry.get("assembly_line.start")).toBeUndefined();
    expect(registry.get("assembly_line.resume")).toBeUndefined();
    expect(registry.get("assembly_run.start")).toBeTypeOf("function");
    expect(registry.get("assembly_run.resume")).toBeTypeOf("function");
  });

  it("routes the post-ingest validate event through the detect tick (one substrate, FR5) — same handler serves the weekly cron and the trigger, running in the detect station pod either way", () => {
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
