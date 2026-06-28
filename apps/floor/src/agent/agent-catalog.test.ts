import { describe, it, expect } from "vitest";
import {
  buildAgentDefinition,
  buildStation,
  buildCatalog,
  catalogChartYaml,
  type TaskTypeConfig,
} from "./agent-catalog.js";

const impl: TaskTypeConfig = {
  prompt_template: "Implement the spec.\n\nSpec: {description}\n",
  model: "claude-sonnet-4-6",
  timeout_minutes: 90,
};

describe("buildAgentDefinition", () => {
  it("maps a recipe: name, model, prompt (+{context}), permission_mode, max_turns", () => {
    expect(buildAgentDefinition("implementation", impl)).toEqual({
      apiVersion: "agents.re-cinq.com/v1alpha1",
      kind: "AgentDefinition",
      metadata: { name: "implementation", labels: { "app.kubernetes.io/managed-by": "lore-catalog-seed" } },
      spec: {
        description: "Lore implementation task recipe (seeded).",
        model: "claude-sonnet-4-6",
        prompt: "Implement the spec.\n\nSpec: {description}\n\n{context}",
        permission_mode: "bypass",
        max_turns: 40,
        output: {
          sinks: [
            { type: "stdout" },
            { type: "http", url: "__AGENT_EVENTS_URL__", headers_secret: "agent-events-auth" },
          ],
        },
      },
    });
  });

  it("omits model when the recipe has none", () => {
    expect(buildAgentDefinition("x", { prompt_template: "do {description}" }).spec).not.toHaveProperty("model");
  });
});

describe("buildStation", () => {
  it("references the AgentDefinition, sets the deadline, and an agent container", () => {
    const station = buildStation("implementation", impl);
    expect(station.spec?.agentDefRef).toBe("implementation");
    expect(station.spec?.deadlineMinutes).toBe(90);
    expect(station.metadata?.name).toBe("implementation");
    const containers = (station.spec?.template as { spec: { containers: Array<{ name: string; image: string }> } }).spec.containers;
    expect(containers[0]).toMatchObject({ name: "agent", image: "node:22-bookworm" });
  });

  it("defaults the deadline to 30 when the recipe has no timeout", () => {
    expect(buildStation("x", { prompt_template: "p" }).spec?.deadlineMinutes).toBe(30);
  });
});

describe("buildCatalog", () => {
  it("emits an AgentDefinition + Station per task type, in order", () => {
    const cat = buildCatalog({ implementation: impl, runbook: { prompt_template: "r" } });
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
  it("renders both kinds for the task type", () => {
    expect(out).toContain("kind: AgentDefinition");
    expect(out).toContain("kind: Station");
    expect(out).toContain("name: implementation");
  });
});
