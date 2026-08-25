import { describe, it, expect, beforeEach } from "vitest";
import { serviceStations, resetServiceStations } from "./service-stations.js";
import { STATIONS } from "../stations/index.js";
import type { StationHost } from "../stations/index.js";

const host = {
  awaitingApproval: async () => [],
  approvalLabel: () => "approved",
  repoFor: async () => {
    throw new Error("unused");
  },
} as unknown as StationHost;

beforeEach(() => resetServiceStations());

describe("serviceStations", () => {
  it("answers to every station in the shared registry that declares an http trigger", () => {
    const expected = Object.values(STATIONS)
      .filter((mod) => mod.manifest.triggers.some((t) => t.kind === "http"))
      .map((mod) => mod.manifest.name);

    for (const name of expected) {
      expect([...serviceStations(host).keys()]).toContain(name);
    }
  });

  it("does not expose a station that declares no http trigger, so a node cannot be run by URL", () => {
    const nodeOnly = Object.values(STATIONS)
      .filter((mod) => !mod.manifest.triggers.some((t) => t.kind === "http"))
      .map((mod) => mod.manifest.name);

    for (const name of nodeOnly) {
      expect([...serviceStations(host).keys()]).not.toContain(name);
    }
  });

  it("runs a registry station against the host this process supplies", async () => {
    const run = serviceStations(host).get("approval-check");

    expect(await run?.()).toBe("Checked 0 tasks, 0 approved");
  });

  it("still answers to merge-check, which has not moved yet", () => {
    expect([...serviceStations(host).keys()]).toContain("merge-check");
  });
});
