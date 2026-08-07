import { describe, it, expect } from "vitest";
import type { AgentDefinition, Station } from "@re-cinq/agent-contracts";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import {
  tokenSecretKey,
  perTaskName,
  needsToken,
  catalogLookupName,
  injectRepoToken,
  perTaskStation,
} from "./per-task-token.js";

const spec: LoreTaskSpec = {
  taskId: "abc12345-6789-0000-1111-222233334444",
  taskType: "implementation",
  description: "d",
  prompt: "p",
  targetRepo: "re-cinq/lore",
  branch: "feat/x",
  model: "claude-sonnet-4-6",
  timeoutMinutes: 90,
};

const catalogDef: AgentDefinition = {
  apiVersion: "agents.re-cinq.com/v1alpha1",
  kind: "AgentDefinition",
  metadata: {
    name: "implementation",
    labels: { "app.kubernetes.io/managed-by": "lore-catalog-seed" },
  },
  spec: {
    description: "impl recipe",
    model: "claude-sonnet-4-6",
    prompt: "do {description}",
    permission_mode: "bypass",
    max_turns: 40,
  },
};

const catalogStation: Station = {
  apiVersion: "agents.re-cinq.com/v1alpha1",
  kind: "Station",
  metadata: {
    name: "implementation",
    labels: { "app.kubernetes.io/managed-by": "lore-catalog-seed" },
  },
  spec: {
    agentDefRef: "implementation",
    deadlineMinutes: 90,
    template: {
      spec: { containers: [{ name: "agent", image: "node:22-bookworm" }] },
    },
  },
};

describe("tokenSecretKey / perTaskName", () => {
  it("derive per-task names from the first 8 of the task id", () => {
    expect(tokenSecretKey(spec.taskId)).toBe("GH_TOKEN_abc12345");
    expect(perTaskName(spec.taskId)).toBe("pt-abc12345");
  });
});

describe("catalogLookupName", () => {
  it("resolves a station node's recipe by its stationRef (def-ingest), not the line's task type", () => {
    expect(catalogLookupName({ ...spec, stationRef: "def-ingest" })).toBe(
      "def-ingest",
    );
  });

  it("falls back to the task type for a plain task with no explicit Station", () => {
    expect(catalogLookupName(spec)).toBe("implementation");
  });
});

describe("needsToken", () => {
  it("true when the task targets a repo", () => {
    expect(needsToken(spec)).toBe(true);
  });
  it("false when there is no target repo", () => {
    expect(needsToken({ ...spec, targetRepo: "" })).toBe(false);
  });
});

describe("injectRepoToken", () => {
  const def = injectRepoToken(
    catalogDef,
    spec,
    "GH_TOKEN_abc12345",
    "pt-abc12345",
  );

  it("renames, labels with the task id, and preserves the catalog recipe", () => {
    expect(def.metadata).toEqual({
      name: "pt-abc12345",
      labels: {
        "app.kubernetes.io/managed-by": "lore-catalog-seed",
        "lore.re-cinq.com/task-id": spec.taskId,
      },
    });
    expect(def.spec).toMatchObject({
      model: "claude-sonnet-4-6",
      prompt: "do {description}",
      permission_mode: "bypass",
      max_turns: 40,
    });
  });
  it("adds the target repo with the per-task token-secret key and clone URL + ref", () => {
    expect(def.spec?.resources?.repos).toEqual([
      {
        name: "target",
        url: "https://github.com/re-cinq/lore.git",
        ref: "feat/x",
        token_secret: "GH_TOKEN_abc12345",
      },
    ]);
  });
  it("omits ref when the spec has no branch", () => {
    const repo = injectRepoToken(catalogDef, { ...spec, branch: "" }, "k", "n")
      .spec?.resources?.repos?.[0];

    expect(repo).not.toHaveProperty("ref");
  });
  it("tolerates a catalog AgentDefinition with no labels", () => {
    const def = injectRepoToken(
      { kind: "AgentDefinition", spec: { model: "m", prompt: "p" } },
      spec,
      "k",
      "n",
    );

    expect(def.metadata?.labels).toEqual({
      "lore.re-cinq.com/task-id": spec.taskId,
    });
  });
});

describe("perTaskStation", () => {
  it("renames, labels, and points agentDefRef at the per-task AgentDefinition (template preserved)", () => {
    const station = perTaskStation(
      catalogStation,
      "pt-abc12345",
      "pt-abc12345",
      spec.taskId,
    );

    expect(station.metadata).toEqual({
      name: "pt-abc12345",
      labels: {
        "app.kubernetes.io/managed-by": "lore-catalog-seed",
        "lore.re-cinq.com/task-id": spec.taskId,
      },
    });
    expect(station.spec?.agentDefRef).toBe("pt-abc12345");
    expect(station.spec?.template).toEqual(catalogStation.spec?.template);
  });
  it("tolerates a catalog Station with no spec (empty template fallback)", () => {
    const station = perTaskStation({ kind: "Station" }, "n", "d", spec.taskId);

    expect(station.spec).toEqual({ template: {}, agentDefRef: "d" });
  });
});
