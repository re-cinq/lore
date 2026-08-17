import { describe, it, expect } from "vitest";
import { parseCarriedRunIdentity } from "./carried-run-identity.js";

const full = {
  assembly_run: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  node: "implement",
  iteration: 2,
  station_run: "11111111-2222-4333-8444-555555555555",
};

describe("parseCarriedRunIdentity", () => {
  it("reads the identity a producer stamped into the attribution", () => {
    expect(parseCarriedRunIdentity(full)).toEqual({
      assemblyLineId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      nodeId: "implement",
      iteration: 2,
      stationRunId: "11111111-2222-4333-8444-555555555555",
    });
  });

  it("reads an identity that names no station run, which older producers omit", () => {
    const { station_run, ...withoutStationRun } = full;

    expect(parseCarriedRunIdentity(withoutStationRun)).toMatchObject({
      nodeId: "implement",
      stationRunId: null,
    });
    expect(station_run).toBeTypeOf("string");
  });

  it("returns null for an attribution carrying no identity at all", () => {
    expect(parseCarriedRunIdentity({ task: "t1", agent: "cr-a" })).toBeNull();
  });

  it("returns null when only part of the identity is present", () => {
    // A partial identity is worse than none: it would attribute the row to a run
    // while leaving which VISIT produced it to a guess, mixing a stamped id with
    // an inferred node — so the whole tuple is required or the CR-name fallback
    // stays in charge.
    expect(
      parseCarriedRunIdentity({ assembly_run: full.assembly_run }),
    ).toBeNull();
    expect(
      parseCarriedRunIdentity({
        assembly_run: full.assembly_run,
        node: "implement",
      }),
    ).toBeNull();
  });

  it("returns null for an iteration that is not a whole number", () => {
    expect(parseCarriedRunIdentity({ ...full, iteration: 1.5 })).toBeNull();
    expect(parseCarriedRunIdentity({ ...full, iteration: "2" })).toBeNull();
  });

  it("returns null for a non-object attribution", () => {
    expect(parseCarriedRunIdentity(null)).toBeNull();
    expect(parseCarriedRunIdentity("nope")).toBeNull();
  });
});
