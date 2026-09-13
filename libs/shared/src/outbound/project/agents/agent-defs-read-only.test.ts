import { describe, it, expect } from "vitest";
import { AgentDefsHttp } from "./agent-defs-http.js";
import { AgentDefsYaml } from "./agent-defs-yaml.js";

describe("agent-definition read adapters carry no write surface", () => {
  it("neither AgentDefsHttp nor AgentDefsYaml exposes create/update/delete", () => {
    const http = new AgentDefsHttp("http://127.0.0.1:1");
    const yaml = new AgentDefsYaml();

    for (const adapter of [http, yaml]) {
      expect("create" in adapter).toBe(false);
      expect("update" in adapter).toBe(false);
      expect("delete" in adapter).toBe(false);
    }
  });
});
