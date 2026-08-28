import { describe, it, expect } from "vitest";
import {
  buildAgentDefinition,
  buildStation,
  buildCatalog,
  catalogChartYaml,
  type AgentCatalogConfig,
  buildStationDefinition,
  LLM_SECRET_SENTINEL,
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
        max_turns: 200,
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

  it("a deterministic station recipe swaps ANTHROPIC for the Lore API pair every station pod needs", () => {
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

  it("declares a produced artifact so it can leave the pod", () => {
    const planning = buildAgentDefinition("feature-planning", {
      prompt_template: "plan {description}",
      watch: { event: "planning.result", path: "target/result.json" },
    });

    expect(planning.spec?.output?.watch).toEqual([
      { event: "planning.result", path: "target/result.json" },
    ]);
  });

  it("declares no artifact for a recipe whose deliverable is its output", () => {
    expect(
      buildAgentDefinition("general", { prompt_template: "do {description}" })
        .spec?.output?.watch,
    ).toBeUndefined();
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

  it("emits an unguarded doc stream — the catalog-seed hook owns the seedCatalog gate — and keeps every object on uninstall", () => {
    // The docs moved out of templates/ into a file the pre-upgrade hook applies
    // server-side, because Helm diffs RENDERED manifests and so never repairs an
    // object the API server pruned (#1468). The gate moved with the hook.
    expect(out).toContain("DO NOT EDIT.");
    expect(out).not.toContain("{{- if .Values.seedCatalog }}");
    expect(out).toContain("helm.sh/resource-policy: keep");
  });
  it("guards the {context} placeholder behind .Values.loreMcpUrl — a pod with no gateway is never told to call a tool it does not have", () => {
    // The parameter that fills this slot is an INSTRUCTION to call
    // lore_assemble_context (dispatch-time hydration was removed 2026-08-28). A
    // satellite renders no mcp_servers block, because the gateway authenticates
    // with LORE_INGEST_TOKEN and FR5 keeps that credential central — so on those
    // pods the placeholder must vanish with the tool it points at (#1629).
    expect(out).toMatch(
      /\{\{- if \.Values\.loreMcpUrl \}\}\n *\{context\}\n\{\{- end \}\}/,
    );
  });

  it("names its generated home and the hook that applies it in the header, so a reader of the file finds the mechanism", () => {
    expect(out).toContain("files/catalog-seed.yaml");
    expect(out).toContain("catalog-seed");
  });
  it("templates the agent-events sink URL with the helm value (no sentinel leaks)", () => {
    expect(out).toContain("url: {{ .Values.agentEventsUrl }}");
    expect(out).not.toContain("__AGENT_EVENTS_URL__");
  });
  it("guards the http telemetry sink behind .Values.agentEventsUrl so a deployment without it never asks a pod for a secret it cannot have", () => {
    // The standalone satellite chart has no bus-wide LORE_AGENT_INTERNAL_TOKEN
    // to give this sink, and its default agentEventsUrl is empty — an
    // unguarded sink is a hard CreateContainerConfigError on every satellite
    // pod, of every node type (#1575).
    expect(out).toMatch(
      /\{\{- if \.Values\.agentEventsUrl \}\}\n *- type: http\n *url: \{\{ \.Values\.agentEventsUrl \}\}\n *headers_secret: agent-events-auth\n\{\{- end \}\}/,
    );
    // stdout stays unconditional — a satellite still gets pod-log output.
    expect(out).toMatch(/sinks:\n *- type: stdout\n *\{\{- if/);
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

describe("read-only review recipes (#1160)", () => {
  const reviewer: AgentCatalogConfig = {
    prompt_template: "Review the diff.",
    disallowed_tools: ["Bash(npm:*)", "Bash(npx:*)"],
    repo_workdir: false,
  };

  it("appends the recipe's disallowed_tools after the base pipeline-tool deny", () => {
    expect(
      buildAgentDefinition("code-review", reviewer).spec?.disallowed_tools,
    ).toEqual([
      "mcp__lore__lore_create_pipeline_task",
      "Bash(npm:*)",
      "Bash(npx:*)",
    ]);
  });

  it("keeps only the base deny when the recipe declares no disallowed_tools", () => {
    expect(
      buildAgentDefinition("implementation", impl).spec?.disallowed_tools,
    ).toEqual(["mcp__lore__lore_create_pipeline_task"]);
  });

  it("omits the container workingDir when repo_workdir is false", () => {
    const containers = (
      buildStation("code-review", reviewer).spec?.template as {
        spec: { containers: Array<{ name: string; workingDir?: string }> };
      }
    ).spec.containers;

    expect(containers[0].workingDir).toBeUndefined();
  });
});

describe("buildAgentDefinition without a prompt", () => {
  it("throws naming the task type rather than seeding an empty recipe", () => {
    expect(() => buildAgentDefinition("gap-fill", {})).toThrow(
      new Error(
        'task type "gap-fill" has no prompt_template — task-types.yaml is missing a field the catalog needs',
      ),
    );
  });
});

describe("buildStationDefinition without a command", () => {
  it("throws naming the station rather than seeding a pod with nothing to run", () => {
    expect(() => buildStationDefinition("ingest", {})).toThrow(
      new Error(
        'station "ingest" has no command — task-types.yaml is missing a field the catalog needs',
      ),
    );
  });
});

describe("a station that makes a model call gets a model credential", () => {
  it("declares the LLM secret for a station whose recipe says it needs one", () => {
    const def = buildStationDefinition("comment-triage", {
      command: ["lore-station", "comment-triage"],
      timeout_minutes: 5,
      needs_model: true,
    });

    expect(def.spec?.resources?.secrets?.map((s) => s.name)).toContain(
      LLM_SECRET_SENTINEL,
    );
  });
});
