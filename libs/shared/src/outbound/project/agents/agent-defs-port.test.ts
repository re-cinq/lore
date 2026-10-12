import { describe, it, expect } from "vitest";
import { resolveAgentConfig, type AgentDefinition } from "./agent-defs-port.js";

const orgGeneral: AgentDefinition = {
  name: "general",
  model: "claude-sonnet-4-6",
  timeout_minutes: 30,
  prompt: "Task: {description}",
  image: null,
  execution_mode: "claude-code",
  review_required: true,
  config: null,
  project_id: null,
};

describe("resolveAgentConfig", () => {
  it("returns the org row as stored when no project row exists", () => {
    expect(resolveAgentConfig(null, orgGeneral)).toEqual(orgGeneral);
  });

  it("returns null when every layer is null", () => {
    expect(resolveAgentConfig(null, null)).toBeNull();
  });

  it("lets a project row's set fields beat the org row", () => {
    const org: AgentDefinition = { ...orgGeneral, model: "claude-opus-4-8" };
    const project: AgentDefinition = {
      name: "general",
      model: "claude-haiku-4-5-20251001",
      timeout_minutes: null,
      prompt: null,
      image: null,
      execution_mode: "claude-code",
      review_required: true,
      config: null,
      project_id: "11111111-1111-1111-1111-111111111111",
    };

    const resolved = resolveAgentConfig(project, org);

    expect(resolved).toMatchObject({
      name: "general",
      model: "claude-haiku-4-5-20251001",
      timeout_minutes: 30,
      prompt: "Task: {description}",
      project_id: "11111111-1111-1111-1111-111111111111",
    });
  });

  it("inherits a nullable field from org when the project row leaves it null", () => {
    const org: AgentDefinition = { ...orgGeneral, image: "golang:1.23" };
    const project: AgentDefinition = {
      ...orgGeneral,
      image: null,
      project_id: "22222222-2222-2222-2222-222222222222",
    };

    expect(resolveAgentConfig(project, org)?.image).toBe("golang:1.23");
  });

  it("inherits config.test_policy from the layer below when a row sets config for another reason, so a review recipe stays at none", () => {
    const orgReview: AgentDefinition = {
      ...orgGeneral,
      name: "review",
      config: {
        skills: ["tdd-loop"],
        test_policy: "none",
        repo_workdir: false,
      },
    };
    const project: AgentDefinition = {
      ...orgReview,
      config: { skills: ["review-checklist"] },
      project_id: "33333333-3333-3333-3333-333333333333",
    };

    expect(resolveAgentConfig(project, orgReview)?.config).toEqual({
      skills: ["review-checklist"],
      test_policy: "none",
    });
    expect(
      resolveAgentConfig(
        { ...project, config: { test_policy: "scoped" } },
        orgReview,
      )?.config,
    ).toEqual({ test_policy: "scoped" });
  });
});
