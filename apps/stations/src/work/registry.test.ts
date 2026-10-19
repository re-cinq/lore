import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { STATIONS, STATION_NAMES } from "./registry.js";

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
});
