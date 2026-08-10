import { describe, it, expect } from "vitest";
import {
  buildAgentDefinition,
  buildStation,
  buildCatalog,
  catalogChartYaml,
  type AgentCatalogConfig,
  buildStationDefinition,
  buildStationStation,
  type StationCatalogConfig,
} from "./agent-catalog.js";

const impl: AgentCatalogConfig = {
  prompt_template: "Implement the spec.\n\nSpec: {description}\n",
  model: "claude-sonnet-4-6",
  timeout_minutes: 90,
};

describe("buildAgentDefinition", () => {
  it("maps a recipe: name, model, prompt (+{context}), permission_mode, max_turns", () => {
    expect(buildAgentDefinition("implementation", impl)).toEqual({
      apiVersion: "agents.re-cinq.com/v1alpha1",
      kind: "AgentDefinition",
      metadata: {
        name: "implementation",
        labels: { "app.kubernetes.io/managed-by": "lore-catalog-seed" },
      },
      spec: {
        description: "Lore implementation task recipe (seeded).",
        model: "claude-sonnet-4-6",
        prompt: "Implement the spec.\n\nSpec: {description}\n\n{context}",
        permission_mode: "bypass",
        max_turns: 40,
        resources: {
          secrets: [{ name: "__LLM_SECRET_KEY__", ref: "__LLM_SECRET_KEY__" }],
          mcp_servers: [
            {
              name: "lore",
              transport: "http",
              url: "__LORE_MCP_URL__",
              headers_secret: "lore-mcp-auth",
            },
          ],
          skills: ["lore-context"],
          skills_source: "__LORE_SKILLS_URL__",
        },
        disallowed_tools: ["mcp__lore__lore_create_pipeline_task"],
        output: {
          sinks: [
            { type: "stdout" },
            {
              type: "http",
              url: "__AGENT_EVENTS_URL__",
              headers_secret: "agent-events-auth",
            },
          ],
        },
      },
    });
  });

  it("declares the LLM-credential sentinel in resources.secrets so the controller injects whichever key the cluster supplies", () => {
    expect(
      buildAgentDefinition("implementation", impl).spec?.resources,
    ).toEqual({
      secrets: [{ name: "__LLM_SECRET_KEY__", ref: "__LLM_SECRET_KEY__" }],
      mcp_servers: [
        {
          name: "lore",
          transport: "http",
          url: "__LORE_MCP_URL__",
          headers_secret: "lore-mcp-auth",
        },
      ],
      skills: ["lore-context"],
      skills_source: "__LORE_SKILLS_URL__",
    });
  });

  it("station recipes swap ANTHROPIC (exec vendor, no model call) for the Lore API pair every lore-station pod needs", () => {
    const resources = buildStationDefinition("validate", {
      command: ["lore-station", "validate"],
      timeout_minutes: 15,
    }).spec?.resources;

    expect(resources?.secrets).toEqual([
      { name: "LORE_INGEST_TOKEN", ref: "LORE_INGEST_TOKEN" },
    ]);
    expect(resources?.env).toEqual([
      { name: "LORE_API_URL", value: "__LORE_API_URL__" },
    ]);
  });

  it("omits model when the recipe has none", () => {
    expect(
      buildAgentDefinition("x", { prompt_template: "do {description}" }).spec,
    ).not.toHaveProperty("model");
  });
});

describe("buildStation", () => {
  it("references the AgentDefinition, sets the deadline, and an agent container", () => {
    const station = buildStation("implementation", impl);

    expect(station.spec?.agentDefRef).toBe("implementation");
    expect(station.spec?.deadlineMinutes).toBe(90);
    expect(station.metadata?.name).toBe("implementation");
    const containers = (
      station.spec?.template as {
        spec: { containers: Array<{ name: string; image: string }> };
      }
    ).spec.containers;

    expect(containers[0]).toMatchObject({
      name: "agent",
      image: "node:22-bookworm",
    });
  });

  it("runs the agent in the cloned repo, the one writable directory its prompts name", () => {
    const containers = (
      buildStation("implementation", impl).spec?.template as {
        spec: { containers: Array<{ name: string; workingDir?: string }> };
      }
    ).spec.containers;

    expect(containers[0].workingDir).toBe("/workspace/target");
  });

  it("defaults the deadline to 30 when the recipe has no timeout", () => {
    expect(
      buildStation("x", { prompt_template: "p" }).spec?.deadlineMinutes,
    ).toBe(30);
  });
});

describe("buildCatalog", () => {
  it("emits an AgentDefinition + Station per task type, in order", () => {
    const cat = buildCatalog({
      implementation: impl,
      runbook: { prompt_template: "r" },
    });

    expect(cat.map((c) => `${c.kind}/${c.metadata?.name}`)).toEqual([
      "AgentDefinition/implementation",
      "Station/implementation",
      "AgentDefinition/runbook",
      "Station/runbook",
    ]);
  });
});

describe("catalogChartYaml", () => {
  const out = catalogChartYaml({ implementation: impl });

  it("guards the seed behind .Values.seedCatalog and keeps it on uninstall", () => {
    expect(out).toContain("DO NOT EDIT.");
    expect(out).toContain("{{- if .Values.seedCatalog }}");
    expect(out).toContain("{{- end }}");
    expect(out).toContain("helm.sh/resource-policy: keep");
  });
  it("templates the agent-events sink URL with the helm value (no sentinel leaks)", () => {
    expect(out).toContain("url: {{ .Values.agentEventsUrl }}");
    expect(out).not.toContain("__AGENT_EVENTS_URL__");
  });
  it("templates the station recipes' LORE_API_URL with the helm value (no sentinel leaks)", () => {
    const withStation = catalogChartYaml(
      {},
      { gate: { command: ["lore-station", "gate"] } },
    );

    expect(withStation).toContain("value: {{ .Values.loreApiUrl }}");
    expect(withStation).not.toContain("__LORE_API_URL__");
  });
  it("templates the LLM credential key with the helm value, as both env name and secret ref (no sentinel leaks)", () => {
    expect(out).toContain("- name: {{ .Values.agentLlmSecretKey }}");
    expect(out).toContain("ref: {{ .Values.agentLlmSecretKey }}");
    expect(out).not.toContain("__LLM_SECRET_KEY__");
  });
  it("guards the skills block behind .Values.loreSkillsUrl so no recipe asks for skills it cannot fetch", () => {
    expect(out).toContain("{{- if .Values.loreSkillsUrl }}");
    expect(out).toContain("skills_source: {{ .Values.loreSkillsUrl }}");
    expect(out).not.toContain("__LORE_SKILLS_URL__");
    // The guard opens immediately before `skills:` and closes after `skills_source:`
    // — an unguarded skills list renders `skills_source: null`, which the init
    // treats as a successful no-op and the agent then dies on the missing
    // settings.json it was supposed to fetch.
    expect(out).toMatch(
      /\{\{- if \.Values\.loreSkillsUrl \}\}\n *skills:\n(?: +- .*\n)+ *skills_source: \{\{ \.Values\.loreSkillsUrl \}\}\n\{\{- end \}\}/,
    );
  });
  it("stamps each CR namespace with the helm value (umbrella spans namespaces)", () => {
    expect(out).toContain("namespace: {{ .Values.namespace }}");
    expect(out).not.toContain("__NAMESPACE__");
  });
  it("renders both kinds for the task type", () => {
    expect(out).toContain("kind: AgentDefinition");
    expect(out).toContain("kind: Station");
    expect(out).toContain("name: implementation");
  });
});

describe("station catalog (exec vendor recipes)", () => {
  const validate: StationCatalogConfig = {
    command: ["lore-station", "validate"],
    timeout_minutes: 15,
  };

  it("buildStationDefinition maps a station recipe: exec model, {station_input} prompt, tool_config.command", () => {
    expect(buildStationDefinition("validate", validate)).toEqual({
      apiVersion: "agents.re-cinq.com/v1alpha1",
      kind: "AgentDefinition",
      metadata: {
        name: "def-validate",
        labels: { "app.kubernetes.io/managed-by": "lore-catalog-seed" },
      },
      spec: {
        description: "Lore validate station recipe (seeded).",
        model: "exec",
        prompt: "{station_input}",
        permission_mode: "bypass",
        max_turns: 1,
        tool_config: { command: ["lore-station", "validate"] },
        output: {
          sinks: [
            { type: "stdout" },
            {
              type: "http",
              url: "__AGENT_EVENTS_URL__",
              headers_secret: "agent-events-auth",
            },
          ],
        },
        resources: {
          env: [{ name: "LORE_API_URL", value: "__LORE_API_URL__" }],
          secrets: [{ name: "LORE_INGEST_TOKEN", ref: "LORE_INGEST_TOKEN" }],
        },
      },
    });
  });

  it("buildStationStation pins the station image and the recipe's deadline (default 15)", () => {
    const station = buildStationStation("validate", validate);

    expect(station.metadata?.name).toBe("def-validate");
    expect(station.spec?.agentDefRef).toBe("def-validate");
    expect(station.spec?.deadlineMinutes).toBe(15);
    const containers = (
      station.spec?.template as {
        spec: { containers: Array<{ image: string }> };
      }
    ).spec.containers;

    expect(containers[0].image).toBe("__STATION_IMAGE__");
    expect(
      buildStationStation("gate", { command: ["lore-station", "gate"] }).spec
        ?.deadlineMinutes,
    ).toBe(15);
  });

  it("stamps configured pod_labels on the Station's POD TEMPLATE metadata — the per-task clone renames the Station, so a name-keyed NetworkPolicy selector loses its pods (template labels survive the clone; the controller merge preserves them)", () => {
    const station = buildStationStation("ingest", {
      command: ["lore-station", "ingest"],
      pod_labels: { "lore.re-cinq.com/dgraph-egress": "true" },
    });

    expect(
      (station.spec?.template as { metadata?: { labels?: unknown } }).metadata
        ?.labels,
    ).toEqual({ "lore.re-cinq.com/dgraph-egress": "true" });
    expect(
      (
        buildStationStation("gate", { command: ["lore-station", "gate"] }).spec
          ?.template as { metadata?: unknown }
      ).metadata,
    ).toBeUndefined();
  });

  it("puts the catalog env on the DEFINITION's resources.env — the controller discards Station template env (def-ingest gets LORE_DGRAPH_HTTP)", () => {
    const definition = buildStationDefinition("ingest", {
      command: ["lore-station", "ingest"],
      env: {
        LORE_DGRAPH_HTTP:
          "http://lore-dgraph-alpha.lore-dgraph.svc.cluster.local:8080",
      },
    });

    expect(definition.spec?.resources?.env).toEqual([
      { name: "LORE_API_URL", value: "__LORE_API_URL__" },
      {
        name: "LORE_DGRAPH_HTTP",
        value: "http://lore-dgraph-alpha.lore-dgraph.svc.cluster.local:8080",
      },
    ]);
    const station = buildStationStation("ingest", {
      command: ["lore-station", "ingest"],
      env: { LORE_DGRAPH_HTTP: "x" },
    });

    expect(
      (
        station.spec?.template as {
          spec: { containers: Array<{ env?: unknown }> };
        }
      ).spec.containers[0].env,
    ).toBeUndefined();
  });

  it("sanitizes underscores in the station name to a valid RFC-1123 k8s name", () => {
    const githubAction: StationCatalogConfig = {
      command: ["lore-station", "github_action"],
      timeout_minutes: 60,
    };

    expect(
      buildStationDefinition("github_action", githubAction).metadata?.name,
    ).toBe("def-github-action");
    const station = buildStationStation("github_action", githubAction);

    expect(station.metadata?.name).toBe("def-github-action");
    expect(station.spec?.agentDefRef).toBe("def-github-action");
  });

  it("buildCatalog appends def-<name> pairs for stations and catalogChartYaml templates the image", () => {
    const cat = buildCatalog({ implementation: impl }, { validate });

    expect(cat.map((c) => `${c.kind}/${c.metadata?.name}`)).toEqual([
      "AgentDefinition/implementation",
      "Station/implementation",
      "AgentDefinition/def-validate",
      "Station/def-validate",
    ]);
    const out = catalogChartYaml({ implementation: impl }, { validate });

    expect(out).toContain("image: {{ .Values.stationImage }}");
    expect(out).not.toContain("__STATION_IMAGE__");
  });
});
