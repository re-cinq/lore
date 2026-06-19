import { describe, it, expect } from "vitest";
import { resolveAgentConfig, type AgentDefinition } from "./agent-defs-port.js";

/**
 * resolveAgentConfig field-merges the three precedence layers — a project row
 * overrides org, which overrides the task-types.yaml default — per nullable
 * field. NULL on a layer means "inherit the next layer down". Real values
 * throughout; no doubles.
 */

const yamlGeneral: AgentDefinition = {
  name: "general",
  model: "claude-sonnet-4-6",
  timeout_minutes: 30,
  prompt: "Task: {description}",
  image: null,
  execution_mode: "claude-code",
  review_required: true,
  project_id: null,
};

describe("resolveAgentConfig", () => {
  it("returns the yaml default when no org or project row exists", () => {
    expect(resolveAgentConfig(null, null, yamlGeneral)).toEqual(yamlGeneral);
  });

  it("returns null when every layer is null", () => {
    expect(resolveAgentConfig(null, null, null)).toBeNull();
  });

  it("lets an org row override the yaml default", () => {
    const org: AgentDefinition = { ...yamlGeneral, model: "claude-opus-4-8", project_id: null };

    expect(resolveAgentConfig(null, org, yamlGeneral)?.model).toBe("claude-opus-4-8");
  });

  it("lets a project row's set fields beat the org row", () => {
    const org: AgentDefinition = { ...yamlGeneral, model: "claude-opus-4-8" };
    const project: AgentDefinition = {
      name: "general",
      model: "claude-haiku-4-5-20251001",
      timeout_minutes: null,
      prompt: null,
      image: null,
      execution_mode: "claude-code",
      review_required: true,
      project_id: "11111111-1111-1111-1111-111111111111",
    };

    const resolved = resolveAgentConfig(project, org, yamlGeneral);

    expect(resolved).toMatchObject({
      name: "general",
      model: "claude-haiku-4-5-20251001", // project wins
      timeout_minutes: 30, // project null → org(30, inherited from yaml-equal)
      prompt: "Task: {description}", // project null → inherited
      project_id: "11111111-1111-1111-1111-111111111111",
    });
  });

  it("inherits a nullable field from org when the project row leaves it null", () => {
    const org: AgentDefinition = { ...yamlGeneral, image: "golang:1.23" };
    const project: AgentDefinition = {
      ...yamlGeneral,
      image: null,
      project_id: "22222222-2222-2222-2222-222222222222",
    };

    expect(resolveAgentConfig(project, org, yamlGeneral)?.image).toBe("golang:1.23");
  });

  it("inherits append_system_prompt from org when the project leaves it unset", () => {
    const org: AgentDefinition = { ...yamlGeneral, append_system_prompt: "Add validated-by links." };
    const project: AgentDefinition = { ...yamlGeneral, project_id: "33333333-3333-3333-3333-333333333333" };

    expect(resolveAgentConfig(project, org, yamlGeneral)?.append_system_prompt).toBe("Add validated-by links.");
  });

  it("replaces the whole resources block from the highest layer that sets it", () => {
    const org: AgentDefinition = { ...yamlGeneral, resources: { env: [{ name: "ORG", value: "1" }] } };
    const project: AgentDefinition = {
      ...yamlGeneral,
      project_id: "44444444-4444-4444-4444-444444444444",
      resources: { secrets: [{ name: "GITHUB_TOKEN", ref: "github-token" }] },
    };

    expect(resolveAgentConfig(project, org, yamlGeneral)?.resources).toEqual({
      secrets: [{ name: "GITHUB_TOKEN", ref: "github-token" }],
    });
  });

  it("resolves permission_mode and max_turns with project winning over org", () => {
    const org: AgentDefinition = { ...yamlGeneral, permission_mode: "bypass", max_turns: 10 };
    const project: AgentDefinition = {
      ...yamlGeneral,
      project_id: "55555555-5555-5555-5555-555555555555",
      permission_mode: "auto",
      max_turns: 40,
    };

    expect(resolveAgentConfig(project, org, yamlGeneral)).toMatchObject({
      permission_mode: "auto",
      max_turns: 40,
    });
  });
});
