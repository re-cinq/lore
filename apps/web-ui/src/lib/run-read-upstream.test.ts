import { describe, expect, it } from "vitest";
import {
  eventsUpstream,
  nodeLogsUpstream,
  turnsUpstream,
} from "./run-read-upstream";

const floor = { upstreamUrl: "http://floor:8080", token: "floor-token" };
const loreApi = { upstreamUrl: "http://api:3000", token: "api-token" };

describe("turnsUpstream", () => {
  it("reads a floor run's turns from lore-api", () => {
    expect(
      turnsUpstream({ id: "run-1", engine: "floor" }, floor, loreApi),
    ).toEqual({
      url: "http://api:3000/api/assembly-runs/run-1/turns",
      token: "api-token",
    });
  });

  it("reads a lore run's turns from the Floor", () => {
    expect(
      turnsUpstream({ id: "run-1", engine: "lore" }, floor, loreApi),
    ).toEqual({
      url: "http://floor:8080/api/agent-turns/run-1",
      token: "floor-token",
    });
  });

  it("reads from the Floor when no lore-api is configured", () => {
    expect(
      turnsUpstream({ id: "run-1", engine: "floor" }, floor, null).url,
    ).toBe("http://floor:8080/api/agent-turns/run-1");
  });
});

describe("eventsUpstream", () => {
  it("reads a floor run's events from lore-api", () => {
    expect(
      eventsUpstream({ id: "run-1", engine: "floor" }, floor, loreApi),
    ).toEqual({
      url: "http://api:3000/api/assembly-runs/run-1/events",
      token: "api-token",
    });
  });

  it("reads a lore run's events from the Floor", () => {
    expect(eventsUpstream({ id: "run-1" }, floor, loreApi).url).toBe(
      "http://floor:8080/api/agent-events/run-1",
    );
  });
});

describe("nodeLogsUpstream", () => {
  it("reads a floor node's logs from lore-api under the run and the encoded name", () => {
    expect(
      nodeLogsUpstream(
        { id: "run-1", engine: "floor" },
        "floor/visit 1",
        floor,
        loreApi,
      ),
    ).toEqual({
      url: "http://api:3000/api/assembly-runs/run-1/nodes/floor%2Fvisit%201/logs",
      token: "api-token",
    });
  });

  it("reads a lore node's logs from the Floor by the pod's name", () => {
    expect(
      nodeLogsUpstream({ id: "run-1" }, "cr-implement", floor, loreApi).url,
    ).toBe("http://floor:8080/api/agent-logs/cr-implement");
  });
});
