import { describe, it, expect } from "vitest";
import { userInfo } from "node:os";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { fakeLoreApi, specDescription } from "./shared/fake-lore-api.js";
import {
  RETRY_STATION_DESCRIPTION,
  registerRetryStationTool,
} from "./retry-station.js";

const api = fakeLoreApi();
const RERUN = "/api/assembly-runs/r1/nodes/tdd-round/run";
const retryOn = (mode: "full" | "agent") =>
  toolHandlers(registerRetryStationTool, mode)["lore_retry_station"];
const textOf = async (mode: "full" | "agent") =>
  (await retryOn(mode)({ run_id: "r1", node: "tdd-round" })).content[0].text;

describe("lore_retry_station", () => {
  it("asks for station tdd-round of run r1 again in the laptop user's name", async () => {
    api.answer(`POST ${RERUN}`, { run_id: "r1", pending: false }, 202);

    expect(JSON.parse(await textOf("full"))).toEqual({
      run_id: "r1",
      pending: false,
    });
    expect(api.posted).toEqual([
      {
        path: RERUN,
        body: { requested_by: `lore-mcp:${userInfo().username}` },
      },
    ]);
  });

  it("refuses an agent a station of running run r1 without asking the floor", async () => {
    api.answer("/api/assembly-runs/r1", { line: { status: "running" } });

    expect(JSON.parse(await textOf("agent"))).toEqual({
      refused:
        "run r1 is running: an agent runs a station again only in a settled run, never in its own",
    });
    expect(api.posted).toEqual([]);
  });

  it("asks for a station of failed run r1 again as lore-mcp:agent", async () => {
    api.answer("/api/assembly-runs/r1", { line: { status: "failed" } });
    api.answer(`POST ${RERUN}`, { run_id: "r1", pending: true }, 202);

    expect(JSON.parse(await textOf("agent"))).toEqual({
      run_id: "r1",
      pending: true,
    });
    expect(api.posted).toEqual([
      { path: RERUN, body: { requested_by: "lore-mcp:agent" } },
    ]);
  });

  it("reports an agent's retry of unknown run r1 as HTTP 404 Not Found", async () => {
    expect(await textOf("agent")).toContain("HTTP 404 Not Found");
    expect(api.posted).toEqual([]);
  });

  it("reports the floor's 409 reason 'run was cancelled' as a refusal", async () => {
    api.answer(`POST ${RERUN}`, { message: "run was cancelled" }, 409);

    expect(await textOf("full")).toBe(
      "The Lore API refused lore_retry_station: HTTP 409 Error: run was cancelled",
    );
  });

  it("reports a 400 with no body as refused with no reason given", async () => {
    api.refuse(`POST ${RERUN}`, 400);

    expect(await textOf("full")).toBe(
      "The Lore API refused lore_retry_station: HTTP 400 Error: no reason given",
    );
  });

  it("carries the verbatim description block of specs/mcp-tools/retry-station/spec.md", () => {
    expect(RETRY_STATION_DESCRIPTION).toBe(specDescription("retry-station"));
  });
});
