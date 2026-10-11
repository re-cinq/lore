import { describe, expect, it } from "vitest";
import {
  eventsUpstream,
  nodeLogsUpstream,
  turnsUpstream,
} from "./run-read-upstream";

const loreApi = { upstreamUrl: "http://api:3000", token: "api-token" };

describe("turnsUpstream", () => {
  it("reads the turns of run-1 from lore-api, whichever engine ran it", () => {
    expect(turnsUpstream("run-1", loreApi)).toEqual({
      url: "http://api:3000/api/assembly-runs/run-1/turns",
      token: "api-token",
    });
  });
});

describe("eventsUpstream", () => {
  it("reads the events of run-1 from lore-api", () => {
    expect(eventsUpstream("run-1", loreApi)).toEqual({
      url: "http://api:3000/api/assembly-runs/run-1/events",
      token: "api-token",
    });
  });
});

describe("nodeLogsUpstream", () => {
  it("reads a node's logs from lore-api under the run and the encoded name", () => {
    expect(nodeLogsUpstream("run-1", "floor/visit 1", loreApi)).toEqual({
      url: "http://api:3000/api/assembly-runs/run-1/nodes/floor%2Fvisit%201/logs",
      token: "api-token",
    });
  });
});
