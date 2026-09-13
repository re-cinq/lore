import { describe, it, expect } from "vitest";
import { AgentDefsHttp } from "./agent-defs-http.js";
import { AgentDefsYaml } from "./agent-defs-yaml.js";

// #1899 — split AgentDefsPort into a read port and a write port, with only the
// Pg adapter implementing writes. Today the two read adapters "each declare
// create, update and delete only to throw a shared READ_ONLY constant"; the
// runtime consequence of the split is that those write stubs disappear entirely
// — a runner-side adapter carries NO write surface at all, so the refusal is a
// missing method rather than a runtime throw a caller only trips over at run time.

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
