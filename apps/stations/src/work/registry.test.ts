import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { NODE_TYPES } from "@re-cinq/lore-assembly-lines";
import { HUMAN_STATION_TYPES } from "@re-cinq/lore-assembly-lines";
import { STATIONS, STATION_NAMES } from "./registry.js";
import { nodeTriggers, isNodeModule } from "./lib/station.js";

const STATION_DIR = import.meta.dirname;

const stationFolders = (): string[] =>
  readdirSync(STATION_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => name !== "lib")
    .sort();

describe("the station registry", () => {
  it("registers every station folder, so adding one and forgetting the barrel fails here", () => {
    expect(Object.keys(STATIONS).sort()).toEqual(stationFolders());
  });

  it("names each station once, since the name is also its URL and its registry key", () => {
    expect(new Set(STATION_NAMES).size).toBe(STATION_NAMES.length);
  });

  it("gives every station a manifest whose name matches the key it is filed under", () => {
    const mismatched = Object.entries(STATIONS)
      .filter(([key, mod]) => mod.manifest.name !== key)
      .map(([key]) => key);

    expect(mismatched).toEqual([]);
  });

  it("declares at least one trigger per station, so none is unreachable", () => {
    const unreachable = Object.values(STATIONS)
      .filter((mod) => mod.manifest.triggers.length === 0)
      .map((mod) => mod.manifest.name);

    expect(unreachable).toEqual([]);
  });
});

describe("the registry covers the node types a blueprint can name", () => {
  const DISPATCHABLE = NODE_TYPES.filter(
    (t) => t !== "agent" && t !== "feature_review" && t !== "pr_review",
  );

  it("has a station for every dispatchable node type, so none dies at runtime", () => {
    const covered = new Set(
      Object.values(STATIONS)
        .flatMap((mod) => nodeTriggers(mod.manifest))
        .map((t) => t.nodeType),
    );

    expect(DISPATCHABLE.filter((t) => !covered.has(t))).toEqual([]);
  });

  it("claims no node type a blueprint could never name", () => {
    const claimed = Object.values(STATIONS)
      .flatMap((mod) => nodeTriggers(mod.manifest))
      .map((t) => t.nodeType);

    expect(claimed.filter((t) => !NODE_TYPES.includes(t))).toEqual([]);
  });

  it("gives each node type exactly one station, so dispatch is never ambiguous", () => {
    const claimed = Object.values(STATIONS)
      .flatMap((mod) => nodeTriggers(mod.manifest))
      .map((t) => t.nodeType);

    expect(claimed.length).toBe(new Set(claimed).size);
  });

  it("pairs a node manifest with a node runner, never a sweep's", () => {
    const wrong = Object.values(STATIONS)
      .filter((mod) => nodeTriggers(mod.manifest).length > 0)
      .filter((mod) => !isNodeModule(mod))
      .map((mod) => mod.manifest.name);

    expect(wrong).toEqual([]);
  });
});

describe("declared triggers are usable as declared", () => {
  it("declares a cron schedule with five fields, so the emitter can read it", () => {
    const bad = Object.values(STATIONS).flatMap((mod) =>
      mod.manifest.triggers
        .filter((t) => t.kind === "cron")
        .filter((t) => t.schedule.trim().split(/\s+/).length !== 5)
        .map((t) => `${mod.manifest.name}: ${t.schedule}`),
    );

    expect(bad).toEqual([]);
  });

  it("subscribes each event name to one station, so two do not race for it", () => {
    const subscribed = Object.values(STATIONS).flatMap((mod) =>
      mod.manifest.triggers
        .filter((t) => t.kind === "event")
        .flatMap((t) => t.eventNames),
    );

    expect(subscribed.length).toBe(new Set(subscribed).size);
  });

  it("asks for a cloned workspace only where a pod can provide one", () => {
    const impossible = Object.values(STATIONS)
      .flatMap((mod) => nodeTriggers(mod.manifest))
      .filter((t) => t.clone === true && t.runtime !== "pod");

    expect(impossible).toEqual([]);
  });
});

describe("what may run in the pooled service", () => {
  const MUST_BE_ISOLATED = {
    validate: "runs the target repo's own lint and typecheck commands",
    ingest: "reads a cloned working tree and alone holds graph-store egress",
  } as const;

  it.each(Object.entries(MUST_BE_ISOLATED))(
    "keeps %s in its own pod — %s",
    (name) => {
      const triggers = nodeTriggers(
        STATIONS[name as keyof typeof STATIONS].manifest,
      );

      expect(triggers.map((t) => t.runtime)).toEqual(["pod"]);
    },
  );

  it("pools comment-triage — its one model call is enum-constrained, not agentic", () => {
    const triggers = nodeTriggers(STATIONS["comment-triage"].manifest);

    expect(triggers.map((t) => t.runtime)).toEqual(["service"]);
  });

  it("asks for a cloned workspace only where something actually needs one", () => {
    const cloning = Object.values(STATIONS)
      .flatMap((mod) => nodeTriggers(mod.manifest))
      .filter((t) => t.clone === true)
      .map((t) => t.nodeType)
      .sort();

    expect(cloning).toEqual(["ingest", "validate"]);
  });
});

describe("human stations are registered like any other", () => {
  it("declares a manifest for every human station type the loader knows", () => {
    const declared = new Set(
      Object.values(STATIONS).flatMap((mod) =>
        mod.manifest.triggers
          .filter((t) => t.kind === "human")
          .map((t) => t.nodeType),
      ),
    );

    expect([...HUMAN_STATION_TYPES].filter((t) => !declared.has(t))).toEqual(
      [],
    );
  });

  it("gives a human station no run, because its worker is a person", () => {
    const humans = Object.values(STATIONS).filter((mod) =>
      mod.manifest.triggers.some((t) => t.kind === "human"),
    );

    expect(humans.length).toBeGreaterThan(0);
    expect(humans.filter((mod) => "run" in mod)).toEqual([]);
  });
});
