import { describe, it, expect } from "vitest";
import type { AgentDefinition as RecipeDef } from "@re-cinq/lore-shared";
import { agentDefToCrds } from "./agent-crd.js";

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
    const { agentDefinition, station } = agentDefToCrds(full, { eventsUrl: "http://floor/api/agent-events" });
    expect(agentDefinition).toEqual({
      apiVersion: "agents.re-cinq.com/v1alpha1",
      kind: "AgentDefinition",
      metadata: { name: "implementation", labels: { "app.kubernetes.io/managed-by": "lore-catalog-ui" } },
      spec: {
        description: "Lore implementation recipe (UI-authored).",
        model: "claude-sonnet-4-6",
        prompt: "Implement {description}\n\n{context}",
        permission_mode: "bypass",
        max_turns: 40,
        output: {
          sinks: [
            { type: "stdout" },
            { type: "http", url: "http://floor/api/agent-events", headers_secret: "agent-events-auth" },
          ],
        },
      },
    });
    expect(station.spec?.agentDefRef).toBe("implementation");
    expect(station.spec?.deadlineMinutes).toBe(90);
    const containers = (station.spec?.template as { spec: { containers: Array<{ image: string }> } }).spec.containers;
    expect(containers[0].image).toBe("ghcr.io/acme/runner:1");
  });

  it("omits model/prompt when inherited, defaults deadline + image, and stdout-only without an events url", () => {
    const { agentDefinition, station } = agentDefToCrds({
      ...full,
      model: null,
      prompt: null,
      timeout_minutes: null,
      image: null,
    });
    expect(agentDefinition.spec).not.toHaveProperty("model");
    expect(agentDefinition.spec).not.toHaveProperty("prompt");
    expect(agentDefinition.spec?.output?.sinks).toEqual([{ type: "stdout" }]);
    expect(station.spec?.deadlineMinutes).toBe(30);
    const containers = (station.spec?.template as { spec: { containers: Array<{ image: string }> } }).spec.containers;
    expect(containers[0].image).toBe("node:22-bookworm");
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
    const containers = (station.spec?.template as { spec: { containers: Array<{ image: string }> } }).spec.containers;
    expect(containers[0].image).toBe("ghcr.io/re-cinq/lore-station:latest");
  });
});
