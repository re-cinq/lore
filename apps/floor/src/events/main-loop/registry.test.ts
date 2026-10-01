import { describe, it, expect } from "vitest";
import { buildRegistry, withExtra } from "./registry.js";
import {
  RUN_START_EVENT,
  RUN_STATION_EVENT,
} from "@re-cinq/lore-shared/project/assembly-runs/run-events.js";
import { GITHUB_EVENT_NAMES } from "@re-cinq/lore-shared/project/events/github-map.js";
import { AGENT_EVENT_NAMES } from "@re-cinq/lore-shared/project/events/k8s-map.js";
import { cronTickEventNames } from "@re-cinq/lore-shared/scheduler/cron-emitters.js";

const EXTERNAL_FLOOR_EVENT_NAMES = [
  "github.pull_request.opened",
  "github.pull_request.synchronize",
  "github.pull_request.reopened",
  "github.pull_request.ready_for_review",
  "github.pull_request_review_comment.created",
  "github.issue_comment.created",
];

const STATIONS_EVENT_NAMES = [
  "github.issues.labeled",
  "github.repository.renamed",
];

function producibleEventNames(): string[] {
  return [
    ...GITHUB_EVENT_NAMES.filter(
      (name) =>
        !EXTERNAL_FLOOR_EVENT_NAMES.includes(name) &&
        !STATIONS_EVENT_NAMES.includes(name),
    ),
    ...AGENT_EVENT_NAMES,
    "internal.ingest.spec_trace",
    RUN_START_EVENT,
    RUN_STATION_EVENT,
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

  it("leaves the pull-request and comment events the external floor now takes unregistered", () => {
    const registry = buildRegistry();

    expect(
      EXTERNAL_FLOOR_EVENT_NAMES.filter((name) => registry.has(name)),
    ).toEqual([]);
  });

  it("leaves the label and rename events the stations service answers unregistered", () => {
    const registry = buildRegistry();

    expect(STATIONS_EVENT_NAMES.filter((name) => registry.has(name))).toEqual(
      [],
    );
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
