import { describe, it, expect } from "vitest";
import { AgentDefsHttp } from "./agent-defs-http.js";
import { AgentDefsYaml } from "./agent-defs-yaml.js";

describe("AgentDefs read-only adapters", () => {
  it("neither AgentDefsHttp nor AgentDefsYaml exposes create/update/delete", () => {
    const http = new AgentDefsHttp("http://localhost");
    const yaml = new AgentDefsYaml();

    expect("create" in http).toBe(false);
    expect("update" in http).toBe(false);
    expect("delete" in http).toBe(false);

    expect("create" in yaml).toBe(false);
    expect("update" in yaml).toBe(false);
    expect("delete" in yaml).toBe(false);
  });
});
