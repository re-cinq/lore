import { describe, it, expect } from "vitest";
import { AgentDefs } from "./agent-defs.js";
import { FloorAgentDefs } from "./agent-defs-floor.js";
import { InMemoryAgentDefinitions } from "./agent-defs-floor.fixture.js";

describe("T009: Resolve Repo Base Image at Dispatch", () => {
  it("resolves execution image through three layers: agent override then repo base then org default", async () => {
    const floor = new InMemoryAgentDefinitions();

    await floor.put("test-agent", {
      settings: { image: "org-default:latest", model: "claude-3-5" },
      variants: {
        "re-cinq/no-override": {},
        "re-cinq/with-override": { image: "agent-override:latest" },
      },
    });

    const defs = new FloorAgentDefs(floor);

    const noOverride = await new AgentDefs("re-cinq/no-override", defs, {
      rawSettings: async (repo) =>
        repo === "re-cinq/no-override"
          ? { base_image: "repo-base:latest" }
          : null,
    }).resolve("test-agent");

    expect(noOverride?.image).toBe("repo-base:latest");

    const withOverride = await new AgentDefs("re-cinq/with-override", defs, {
      rawSettings: async (repo) =>
        repo === "re-cinq/with-override"
          ? { base_image: "repo-base:latest" }
          : null,
    }).resolve("test-agent");

    expect(withOverride?.image).toBe("agent-override:latest");

    const fallback = await new AgentDefs("re-cinq/no-override", defs, {
      rawSettings: async () => ({ base_image: null }),
    }).resolve("test-agent");

    expect(fallback?.image).toBe("org-default:latest");
  });

  it("applies base image in list() when no agent override is set", async () => {
    const floor = new InMemoryAgentDefinitions();

    await floor.put("test-agent", {
      settings: { image: "org-default:latest", model: "claude-3-5" },
      variants: {
        "re-cinq/no-override": {},
      },
    });

    const defs = new FloorAgentDefs(floor);
    const listed = await new AgentDefs("re-cinq/no-override", defs, {
      rawSettings: async (repo) =>
        repo === "re-cinq/no-override"
          ? { base_image: "repo-base:latest" }
          : null,
    }).list();

    expect(listed[0]?.image).toBe("repo-base:latest");
  });
});
