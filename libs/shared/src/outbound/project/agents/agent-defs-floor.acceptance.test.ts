import { describe, it, expect } from "vitest";
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

    const noOverride = await (defs.resolve as any)(
      "re-cinq/no-override",
      "test-agent",
      "repo-base:latest",
    );

    expect(noOverride?.image).toBe("repo-base:latest");

    const withOverride = await (defs.resolve as any)(
      "re-cinq/with-override",
      "test-agent",
      "repo-base:latest",
    );

    expect(withOverride?.image).toBe("agent-override:latest");

    const fallback = await (defs.resolve as any)(
      "re-cinq/no-override",
      "test-agent",
      null,
    );

    expect(fallback?.image).toBe("org-default:latest");
  });

  it("applies base image for effective image display in list()", async () => {
    const floor = new InMemoryAgentDefinitions();

    await floor.put("test-agent", {
      settings: { image: "org-default:latest", model: "claude-3-5" },
      variants: {
        "re-cinq/no-override": {},
      },
    });

    const defs = new FloorAgentDefs(floor);
    const listed = await (defs.list as any)(
      "re-cinq/no-override",
      "repo-base:latest",
    );

    expect(listed[0]?.image).toBe("repo-base:latest");
  });
});
