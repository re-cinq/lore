import { describe, it, expect } from "vitest";
import type { AgentDefinition as RecipeDef } from "@re-cinq/lore-shared";
import { agentDefToCrds, preserveUnownedFields } from "./agent-crd.js";

const full: RecipeDef = {
  name: "implementation",
  model: "claude-sonnet-4-6",
  timeout_minutes: 90,
  prompt: "Implement {description}",
  image: "ghcr.io/acme/runner:1",
  execution_mode: "claude-code",
  review_required: true,
  project_id: null,
};

describe("agentDefToCrds", () => {
  it("maps a recipe to an AgentDefinition + Station, adding the http telemetry sink", () => {
    const { agentDefinition, station } = agentDefToCrds(full, {
      eventsUrl: "http://floor/api/agent-events",
    });

    expect(agentDefinition).toEqual({
      apiVersion: "agents.re-cinq.com/v1alpha1",
      kind: "AgentDefinition",
      metadata: {
        name: "implementation",
        labels: { "app.kubernetes.io/managed-by": "lore-catalog-ui" },
      },
      spec: {
        // Unconditional, so it appears even with no gateway configured (#1080).
        disallowed_tools: ["mcp__lore__lore_create_pipeline_task"],
        description: "Lore implementation recipe (UI-authored).",
        model: "claude-sonnet-4-6",
        prompt: "Implement {description}\n\n{context}",
        permission_mode: "bypass",
        max_turns: 40,
        output: {
          sinks: [
            { type: "stdout" },
            {
              type: "http",
              url: "http://floor/api/agent-events",
              headers_secret: "agent-events-auth",
            },
          ],
        },
      },
    });
    expect(station.spec?.agentDefRef).toBe("implementation");
    expect(station.spec?.deadlineMinutes).toBe(90);
    const containers = (
      station.spec?.template as {
        spec: { containers: Array<{ image: string }> };
      }
    ).spec.containers;

    expect(containers[0].image).toBe("ghcr.io/acme/runner:1");
  });

  it("omits model when inherited, defaults deadline + image, and stdout-only without an events url", () => {
    const { agentDefinition, station } = agentDefToCrds({
      ...full,
      model: null,
      timeout_minutes: null,
      image: null,
    });

    expect(agentDefinition.spec).not.toHaveProperty("model");
    expect(agentDefinition.spec?.output?.sinks).toEqual([{ type: "stdout" }]);
    expect(station.spec?.deadlineMinutes).toBe(30);
    const containers = (
      station.spec?.template as {
        spec: { containers: Array<{ image: string }> };
      }
    ).spec.containers;

    expect(containers[0].image).toBe("node:22-bookworm");
  });

  it("carries the live Lore MCP gateway onto a UI-authored recipe", () => {
    // A repo that overrides its recipe through /agents used to get a run with no
    // `lore` MCP server at all, so the agent silently lost mid-run memory and
    // context access that every seeded recipe has (#1080).
    const { agentDefinition } = agentDefToCrds(full, {
      mcpUrl: "http://lore-mcp-gateway.lore-api.svc.cluster.local:8080/mcp",
    });

    expect(agentDefinition.spec?.resources?.mcp_servers).toEqual([
      {
        name: "lore",
        transport: "http",
        url: "http://lore-mcp-gateway.lore-api.svc.cluster.local:8080/mcp",
        headers_secret: "lore-mcp-auth",
      },
    ]);
  });

  it("denies lore_create_pipeline_task whether or not a gateway is configured", () => {
    // Defence in depth, and it does NOT depend on the URL: an agent must never
    // spawn more pipeline work from inside a run, and the guard being conditional
    // on deploy config is how it would go missing exactly where it matters.
    expect(agentDefToCrds(full).agentDefinition.spec?.disallowed_tools).toEqual(
      ["mcp__lore__lore_create_pipeline_task"],
    );
    expect(
      agentDefToCrds(full, { mcpUrl: "http://gw/mcp" }).agentDefinition.spec
        ?.disallowed_tools,
    ).toEqual(["mcp__lore__lore_create_pipeline_task"]);
  });

  it("omits mcp_servers entirely when no gateway is deployed", () => {
    // Same posture as the events sink: an unset deploy value leaves the feature
    // inert rather than emitting a server the pod cannot reach.
    expect(
      agentDefToCrds(full).agentDefinition.spec?.resources,
    ).toBeUndefined();
  });

  it("carries the gateway onto a station recipe too", () => {
    // A custom station reads and writes through the same API surface, so it needs
    // the same access — and losing it silently is the bug either way.
    const { agentDefinition } = agentDefToCrds(
      { ...full, name: "def-ingest", execution_mode: "station" },
      { mcpUrl: "http://gw/mcp" },
    );

    expect(agentDefinition.spec?.resources?.mcp_servers?.[0]?.name).toBe(
      "lore",
    );
  });

  it("throws when a claude-code recipe has no prompt", () => {
    expect(() => agentDefToCrds({ ...full, prompt: null })).toThrow(
      "recipe implementation has no prompt",
    );
  });
});

describe("agentDefToCrds — station mode", () => {
  it("materialises an exec-vendor station: model exec, {station_input} prompt, lore-station command", () => {
    const { agentDefinition, station } = agentDefToCrds({
      name: "def-detect",
      model: null,
      timeout_minutes: 30,
      prompt: null,
      image: "ghcr.io/re-cinq/lore-station:latest",
      execution_mode: "station",
      review_required: false,
      project_id: null,
    });

    expect(agentDefinition.spec).toMatchObject({
      model: "exec",
      prompt: "{station_input}",
      max_turns: 1,
      tool_config: { command: ["lore-station", "detect"] },
    });
    expect(station.spec?.deadlineMinutes).toBe(30);
    const containers = (
      station.spec?.template as {
        spec: { containers: Array<{ image: string }> };
      }
    ).spec.containers;

    expect(containers[0].image).toBe("ghcr.io/re-cinq/lore-station:latest");
  });
});

describe("preserveUnownedFields — a UI save never amputates what it does not render (#1301)", () => {
  const live = {
    metadata: {
      name: "feature-planning",
      labels: { "app.kubernetes.io/managed-by": "lore-catalog-seed" },
      annotations: { "helm.sh/resource-policy": "keep" },
      resourceVersion: "42",
    },
    spec: {
      prompt: "old prompt",
      output: {
        sinks: [{ type: "stdout" }],
        watch: [{ event: "planning.result", path: "target/result.json" }],
      },
    },
  };
  const desired = {
    metadata: {
      name: "feature-planning",
      labels: { "app.kubernetes.io/managed-by": "lore-catalog-ui" },
    },
    spec: {
      prompt: "new prompt",
      output: { sinks: [{ type: "stdout" }, { type: "http", url: "x" }] },
    },
  };

  it("carries output.watch through a save whose render does not know it", () => {
    const merged = preserveUnownedFields(live, desired) as typeof live;

    expect(merged.spec.output.watch).toEqual([
      { event: "planning.result", path: "target/result.json" },
    ]);
  });

  it("lets the editor win the fields it owns", () => {
    const merged = preserveUnownedFields(live, desired) as never as {
      spec: { prompt: string; output: { sinks: unknown[] } };
      metadata: { labels: Record<string, string> };
    };

    expect(merged.spec.prompt).toBe("new prompt");
    expect(merged.spec.output.sinks).toHaveLength(2);
    expect(merged.metadata.labels["app.kubernetes.io/managed-by"]).toBe(
      "lore-catalog-ui",
    );
  });

  it("keeps helm's annotations on the object across a UI save", () => {
    const merged = preserveUnownedFields(live, desired) as never as {
      metadata: { annotations: Record<string, string> };
    };

    expect(merged.metadata.annotations["helm.sh/resource-policy"]).toBe("keep");
  });

  it("is a plain pass-through when nothing lives yet (fresh create shape)", () => {
    expect(preserveUnownedFields(undefined, desired)).toMatchObject({
      spec: { prompt: "new prompt" },
    });
  });

  const liveWithResources = {
    ...live,
    spec: {
      ...live.spec,
      resources: {
        skills: ["lore-context"],
        skills_source: "https://lore-mcp.example.com/skills",
        secrets: [{ name: "CLAUDE_CODE_OAUTH_TOKEN", ref: "agent-llm" }],
        mcp_servers: [{ name: "old-lore", transport: "http", url: "old" }],
      },
    },
  };
  const desiredWithResources = {
    ...desired,
    spec: {
      ...desired.spec,
      resources: {
        mcp_servers: [{ name: "lore", transport: "http", url: "new" }],
      },
    },
  };

  it("carries resources.skills_source and secrets through a save that renders only mcp_servers", () => {
    const merged = preserveUnownedFields(
      liveWithResources,
      desiredWithResources,
    ) as typeof liveWithResources;

    expect(merged.spec.resources).toMatchObject({
      skills: ["lore-context"],
      skills_source: "https://lore-mcp.example.com/skills",
      secrets: [{ name: "CLAUDE_CODE_OAUTH_TOKEN", ref: "agent-llm" }],
    });
  });

  it("lets the editor win resources.mcp_servers when it renders them", () => {
    const merged = preserveUnownedFields(
      liveWithResources,
      desiredWithResources,
    ) as typeof liveWithResources;

    expect(merged.spec.resources.mcp_servers).toEqual([
      { name: "lore", transport: "http", url: "new" },
    ]);
  });

  it("carries live resources through a save whose render has no resources at all", () => {
    const merged = preserveUnownedFields(
      liveWithResources,
      desired,
    ) as typeof liveWithResources;

    expect(merged.spec.resources).toEqual(liveWithResources.spec.resources);
  });

  it("carries live resources through a save rendering an explicitly empty resources object", () => {
    const merged = preserveUnownedFields(liveWithResources, {
      ...desired,
      spec: { ...desired.spec, resources: {} },
    }) as typeof liveWithResources;

    expect(merged.spec.resources).toEqual(liveWithResources.spec.resources);
  });
});
