import { describe, it, expect } from "vitest";
import {
  agentDefToCrds,
  catalogCrdName,
  modelFamily,
  SYNC_LABELS,
  validateCatalogEntry,
} from "./agent-crd.js";
import type { ResolvedAgentDefinition } from "../../models/agent-definition.js";

/**
 * The row → CRD-pair mapping that replaced both the Helm catalog seed and
 * lore-api's push mirror: per-cluster values ride options (each unset one OMITS
 * the block it feeds), recipe extras ride the row's config, and per-repo
 * overrides render under a project-qualified name so two repos' overrides of
 * the same task type can no longer replace each other in a shared cluster.
 */

const row = (
  over: Partial<ResolvedAgentDefinition> = {},
): ResolvedAgentDefinition => ({
  name: "implementation",
  model: "claude-sonnet-4-6",
  timeout_minutes: 45,
  prompt: "Implement the task.",
  image: null,
  execution_mode: "claude-code",
  review_required: false,
  project_id: null,
  config: null,
  ...over,
});

const ALL_OPTS = {
  eventsUrl: "https://floor.example/api/agent-events",
  mcpUrl: "https://mcp.example",
  skillsUrl: "https://mcp.example/skills",
  apiUrl: "https://api.example",
  llmSecretKey: "ANTHROPIC_API_KEY",
  stationImage: "ghcr.io/re-cinq/lore-station:abc123",
};

describe("catalogCrdName", () => {
  it("an org default keeps the bare name", () => {
    expect(catalogCrdName("implementation", null)).toEqual("implementation");
  });

  it("a per-repo override folds the first 8 project-id hex chars into the name", () => {
    expect(
      catalogCrdName("implementation", "123e4567-e89b-42d3-a456-426614174000"),
    ).toEqual("implementation--r123e4567");
  });
});

describe("agentDefToCrds LLM recipes", () => {
  it("renders the full recipe when every per-cluster value is set", () => {
    const { agentDefinition, station } = agentDefToCrds(row(), ALL_OPTS);

    expect(agentDefinition.metadata).toEqual({
      name: "implementation",
      labels: SYNC_LABELS,
    });
    expect(agentDefinition.spec).toMatchObject({
      model: "claude-sonnet-4-6",
      prompt: "Implement the task.\n\n{context}",
      permission_mode: "bypass",
      resources: {
        secrets: [{ name: "ANTHROPIC_API_KEY", ref: "ANTHROPIC_API_KEY" }],
        mcp_servers: [
          {
            name: "lore",
            transport: "http",
            url: "https://mcp.example",
            headers_secret: "lore-mcp-auth",
          },
        ],
        skills: ["lore-context"],
        skills_source: "https://mcp.example/skills",
      },
      disallowed_tools: ["mcp__lore__lore_create_pipeline_task"],
      output: {
        sinks: [
          { type: "stdout" },
          {
            type: "http",
            url: "https://floor.example/api/agent-events",
            headers_secret: "agent-events-auth",
          },
        ],
      },
    });
    expect(station.spec).toMatchObject({
      agentDefRef: "implementation",
      deadlineMinutes: 45,
      template: {
        spec: {
          containers: [
            {
              name: "agent",
              image: "node:22-bookworm",
              workingDir: "/workspace/target",
            },
          ],
        },
      },
    });
  });

  it("a satellite's empty options omit the mcp/skills/secret blocks, the http sink AND the {context} placeholder", () => {
    const { agentDefinition } = agentDefToCrds(row(), {});

    expect(agentDefinition.spec?.prompt).toEqual("Implement the task.");
    expect(agentDefinition.spec?.resources).toEqual({
      env: expect.arrayContaining([
        { name: "GIT_AUTHOR_NAME", value: "Lore Agent" },
      ]),
    });
    expect(agentDefinition.spec?.output?.sinks).toEqual([{ type: "stdout" }]);
  });

  it("config skills append after lore-context without duplicating it", () => {
    const { agentDefinition } = agentDefToCrds(
      row({ config: { skills: ["lore-context", "lore-pr"] } }),
      ALL_OPTS,
    );

    expect(agentDefinition.spec?.resources?.skills).toEqual([
      "lore-context",
      "lore-pr",
    ]);
  });

  it("config disallowed_tools append after the pipeline deny and watch rides output", () => {
    const { agentDefinition } = agentDefToCrds(
      row({
        config: {
          disallowed_tools: ["Bash(npm install:*)"],
          watch: { event: "result", path: "/workspace/result.json" },
        },
      }),
      ALL_OPTS,
    );

    expect(agentDefinition.spec?.disallowed_tools).toEqual([
      "mcp__lore__lore_create_pipeline_task",
      "Bash(npm install:*)",
    ]);
    expect(agentDefinition.spec?.output?.watch).toEqual([
      { event: "result", path: "/workspace/result.json" },
    ]);
  });

  it("repo_workdir false omits workingDir for read-only recipes", () => {
    const { station } = agentDefToCrds(
      row({ config: { repo_workdir: false } }),
      ALL_OPTS,
    );
    // StationSpec.template is `unknown` in the contracts package.
    const template = station.spec?.template as {
      spec: { containers: Array<{ workingDir?: string }> };
    };

    expect(template.spec.containers[0]?.workingDir).toBeUndefined();
  });

  it("a promptless recipe is rejected before it can reach an apply", () => {
    expect(() => agentDefToCrds(row({ prompt: null }), ALL_OPTS)).toThrow(
      "recipe implementation has no prompt",
    );
  });

  it("a per-repo override renders both CRs under the qualified name", () => {
    const { agentDefinition, station } = agentDefToCrds(
      row({ project_id: "123e4567-e89b-42d3-a456-426614174000" }),
      ALL_OPTS,
    );

    expect(agentDefinition.metadata?.name).toEqual("implementation--r123e4567");
    expect(station.metadata?.name).toEqual("implementation--r123e4567");
    expect(station.spec?.agentDefRef).toEqual("implementation--r123e4567");
  });
});

describe("agentDefToCrds station recipes", () => {
  const stationRow = () =>
    row({
      name: "def-validate",
      model: null,
      prompt: null,
      timeout_minutes: 10,
      execution_mode: "station",
      config: {
        command: ["lore-station", "validate"],
        env: { LORE_DGRAPH_HTTP: "http://dgraph.gke:8080" },
        pod_labels: { "lore.re-cinq.com/station": "ingest" },
        needs_model: false,
      },
    });

  it("renders the exec-vendor shape on the lore-station image with the ingest token", () => {
    const { agentDefinition, station } = agentDefToCrds(stationRow(), ALL_OPTS);

    expect(agentDefinition.spec).toMatchObject({
      model: "exec",
      prompt: "{station_input}",
      max_turns: 1,
      tool_config: { command: ["lore-station", "validate"] },
      resources: {
        env: [
          { name: "LORE_API_URL", value: "https://api.example" },
          { name: "LORE_DGRAPH_HTTP", value: "http://dgraph.gke:8080" },
        ],
        secrets: [{ name: "LORE_INGEST_TOKEN", ref: "LORE_INGEST_TOKEN" }],
      },
    });
    expect(station.spec).toMatchObject({
      deadlineMinutes: 10,
      template: {
        metadata: { labels: { "lore.re-cinq.com/station": "ingest" } },
        spec: {
          containers: [
            { name: "agent", image: "ghcr.io/re-cinq/lore-station:abc123" },
          ],
        },
      },
    });
  });

  it("a needs_model station additionally carries the cluster's LLM secret", () => {
    const def = stationRow();
    const { agentDefinition } = agentDefToCrds(
      { ...def, config: { ...def.config, needs_model: true } },
      ALL_OPTS,
    );

    expect(agentDefinition.spec?.resources?.secrets).toEqual([
      { name: "LORE_INGEST_TOKEN", ref: "LORE_INGEST_TOKEN" },
      { name: "ANTHROPIC_API_KEY", ref: "ANTHROPIC_API_KEY" },
    ]);
  });

  it("the dgraphUrl option repoints a config LORE_DGRAPH_HTTP entry", () => {
    const { agentDefinition } = agentDefToCrds(stationRow(), {
      ...ALL_OPTS,
      dgraphUrl: "http://dgraph.minikube:8080",
    });

    expect(agentDefinition.spec?.resources?.env).toContainEqual({
      name: "LORE_DGRAPH_HTTP",
      value: "http://dgraph.minikube:8080",
    });
  });

  it("a station row without a command falls back to lore-station plus the def-stripped name", () => {
    const def = stationRow();
    const { agentDefinition } = agentDefToCrds(
      { ...def, config: null },
      ALL_OPTS,
    );

    expect(agentDefinition.spec?.tool_config).toEqual({
      command: ["lore-station", "validate"],
    });
  });
});

describe("modelFamily", () => {
  it("maps claude to anthropic, gemini to gemini, gpt/oN to openai, and anything else to null", () => {
    expect(modelFamily("claude-sonnet-4-6")).toEqual("anthropic");
    expect(modelFamily("gemini-2.5-pro")).toEqual("gemini");
    expect(modelFamily("gpt-5")).toEqual("openai");
    expect(modelFamily("o3-mini")).toEqual("openai");
    expect(modelFamily("llama-3")).toBeNull();
  });
});

describe("validateCatalogEntry", () => {
  it("refuses a name Kubernetes can never accept — the def-github_action leftover", () => {
    expect(
      validateCatalogEntry(
        row({ name: "def-github_action", execution_mode: "station" }),
        ALL_OPTS,
      ),
    ).toContain("not a valid Kubernetes resource name");
  });

  it("refuses a promptless LLM recipe before it can reach an apply", () => {
    expect(validateCatalogEntry(row({ prompt: null }), ALL_OPTS)).toContain(
      "has no prompt",
    );
  });

  it("refuses a model whose family this cluster holds no credential for — the gemini-2.5-pro incident", () => {
    expect(
      validateCatalogEntry(row({ model: "gemini-2.5-pro" }), {
        modelSecretKeys: { anthropic: "ANTHROPIC_API_KEY" },
      }),
    ).toContain('no credential for the "gemini" family');
  });

  it("refuses a model no family claims", () => {
    expect(
      validateCatalogEntry(row({ model: "totally-made-up-1" }), ALL_OPTS),
    ).toContain("no known credential family");
  });

  it("accepts a served family, a station row, and a keyless bare cluster", () => {
    expect(validateCatalogEntry(row(), ALL_OPTS)).toBeNull();
    expect(
      validateCatalogEntry(row({ model: "gemini-2.5-pro" }), {
        modelSecretKeys: { gemini: "GEMINI_API_KEY" },
      }),
    ).toBeNull();
    expect(
      validateCatalogEntry(
        row({ name: "def-validate", execution_mode: "station", prompt: null }),
        ALL_OPTS,
      ),
    ).toBeNull();
    expect(validateCatalogEntry(row(), {})).toBeNull();
  });
});

describe("model-family credentials in the render", () => {
  it("a gemini recipe renders the gemini key, not the cluster's anthropic habit", () => {
    const { agentDefinition } = agentDefToCrds(
      row({ model: "gemini-2.5-pro" }),
      {
        ...ALL_OPTS,
        modelSecretKeys: {
          anthropic: "ANTHROPIC_API_KEY",
          gemini: "GEMINI_API_KEY",
        },
      },
    );

    expect(agentDefinition.spec?.resources?.secrets).toEqual([
      { name: "GEMINI_API_KEY", ref: "GEMINI_API_KEY" },
    ]);
  });

  it("the legacy llmSecretKey stays the anthropic fallback when no map is given", () => {
    const { agentDefinition } = agentDefToCrds(row(), ALL_OPTS);

    expect(agentDefinition.spec?.resources?.secrets).toEqual([
      { name: "ANTHROPIC_API_KEY", ref: "ANTHROPIC_API_KEY" },
    ]);
  });
});

describe("validate/render agreement on defaults and merges", () => {
  it("a modelless recipe on a gemini-only cluster is refused — the render's anthropic default is the validator's too", () => {
    expect(
      validateCatalogEntry(row({ model: null }), {
        modelSecretKeys: { gemini: "GEMINI_API_KEY" },
      }),
    ).toContain('no credential for the "anthropic" family');
  });

  it("a needs_model station on an anthropic-less cluster is refused instead of silently dropping its key", () => {
    expect(
      validateCatalogEntry(
        row({
          name: "def-comment-triage",
          execution_mode: "station",
          prompt: null,
          config: { needs_model: true },
        }),
        { modelSecretKeys: { gemini: "GEMINI_API_KEY" } },
      ),
    ).toContain("no anthropic credential");
  });

  it("an explicit llmSecretKey override wins the anthropic slot over the chart's default map", () => {
    const { agentDefinition } = agentDefToCrds(row(), {
      llmSecretKey: "CLAUDE_CODE_OAUTH_TOKEN",
      modelSecretKeys: { anthropic: "ANTHROPIC_API_KEY" },
    });

    expect(agentDefinition.spec?.resources?.secrets).toEqual([
      { name: "CLAUDE_CODE_OAUTH_TOKEN", ref: "CLAUDE_CODE_OAUTH_TOKEN" },
    ]);
  });
});
