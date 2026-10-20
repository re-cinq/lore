import { describe, it, expect } from "vitest";
import { AgentDefsHttp } from "./agent-defs-http.js";
import { AgentDefsFiles } from "./agent-defs-files.js";

describe("AgentDefs read-only adapters", () => {
  it("AgentDefsHttp exposes no create/update/delete", () => {
    const http = new AgentDefsHttp("http://localhost");

    expect(["create", "update", "delete"].filter((m) => m in http)).toEqual([]);
  });

  it("AgentDefsFiles exposes no create/update/delete", () => {
    const files = new AgentDefsFiles();

    expect(["create", "update", "delete"].filter((m) => m in files)).toEqual(
      [],
    );
  });
});
