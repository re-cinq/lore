import { describe, it, expect } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { fakeLoreApi, specDescription } from "./shared/fake-lore-api.js";
import { GET_RUN_DESCRIPTION, registerGetRunTool } from "./get-run.js";

const api = fakeLoreApi();
const getRun = toolHandlers(registerGetRunTool, "agent")["lore_get_run"];
const textOf = async (runId: string) =>
  (await getRun({ run_id: runId })).content[0].text;

describe("lore_get_run", () => {
  it("joins run r1 with its nodes, dod and token usage", async () => {
    api.answer("/api/assembly-runs/r1", { id: "r1", status: "failed" });
    api.answer("/api/assembly-runs/r1/nodes", { nodes: [{ name: "dod" }] });
    api.answer("/api/assembly-runs/r1/dod", { items: [] });
    api.answer("/api/assembly-runs/r1/token-usage", { total: 12 });

    expect(JSON.parse(await textOf("r1"))).toEqual({
      run: { id: "r1", status: "failed" },
      nodes: { nodes: [{ name: "dod" }] },
      dod: { items: [] },
      token_usage: { total: 12 },
    });
  });

  it("keeps a run without a dod as dod {error: 'HTTP 404 Not Found'}", async () => {
    api.answer("/api/assembly-runs/r1", { id: "r1" });

    expect(JSON.parse(await textOf("r1"))).toMatchObject({
      dod: { error: "HTTP 404 Not Found" },
    });
  });

  it("encodes run id 'a/b' as a%2Fb", async () => {
    await textOf("a/b");

    expect(api.requested).toContain("/api/assembly-runs/a%2Fb");
  });

  it("carries the verbatim description block of specs/mcp-tools/get-run/spec.md", () => {
    expect(GET_RUN_DESCRIPTION).toBe(specDescription("get-run"));
  });
});
