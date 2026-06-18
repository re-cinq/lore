import { describe, it, expect } from "vitest";
import { selectStationBackend } from "./station-port.js";

describe("selectStationBackend", () => {
  it("honors an explicit k8s override", () => {
    expect(selectStationBackend({ LORE_STATION_BACKEND: "k8s" })).toBe("k8s");
  });

  it("honors an explicit docker override even in-cluster", () => {
    expect(
      selectStationBackend({ LORE_STATION_BACKEND: "docker", KUBERNETES_SERVICE_HOST: "10.0.0.1" }),
    ).toBe("docker");
  });

  it("honors the inprocess escape hatch", () => {
    expect(selectStationBackend({ LORE_STATION_BACKEND: "inprocess" })).toBe("inprocess");
  });

  it("defaults to k8s in-cluster", () => {
    expect(selectStationBackend({ KUBERNETES_SERVICE_HOST: "10.0.0.1" })).toBe("k8s");
  });

  it("defaults to docker off-cluster", () => {
    expect(selectStationBackend({})).toBe("docker");
  });

  it("ignores an unrecognized value and falls back to context", () => {
    expect(selectStationBackend({ LORE_STATION_BACKEND: "bogus" })).toBe("docker");
    expect(
      selectStationBackend({ LORE_STATION_BACKEND: "bogus", KUBERNETES_SERVICE_HOST: "x" }),
    ).toBe("k8s");
  });
});
