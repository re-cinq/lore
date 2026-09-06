import { describe, it, expect } from "vitest";
import {
  parseAgentInput,
  parseAgentPatch,
  imageFieldTouched,
  configWithPodResources,
} from "./agents-schema.js";

describe("parseAgentInput", () => {
  it("normalizes a full body onto AgentDefinitionInput with null for absent fields", () => {
    expect(
      parseAgentInput({
        name: "general",
        model: "claude-opus-4-8",
        timeout_minutes: 45,
      }),
    ).toEqual({
      name: "general",
      model: "claude-opus-4-8",
      timeout_minutes: 45,
      prompt: null,
      image: null,
      execution_mode: "claude-code",
      review_required: false,
      config: null,
    });
  });

  it("rejects a non-kebab-case name", () => {
    expect(() => parseAgentInput({ name: "General" })).toThrow();
  });

  it("rejects a timeout above the 1440-minute ceiling", () => {
    expect(() =>
      parseAgentInput({ name: "general", timeout_minutes: 5000 }),
    ).toThrow();
  });

  it("keeps pod_resources beside a null config on create so the route can merge it over the inherited layer", () => {
    expect(
      parseAgentInput({
        name: "fix-ci",
        pod_resources: { limits: { memory: "4Gi" } },
      }),
    ).toMatchObject({
      name: "fix-ci",
      config: null,
      pod_resources: { limits: { memory: "4Gi" } },
    });
  });

  it("accepts exa-scale quantities 1E and 2Ei", () => {
    expect(
      parseAgentInput({
        name: "fix-ci",
        pod_resources: { limits: { memory: "2Ei", "ephemeral-storage": "1E" } },
      }),
    ).toMatchObject({
      pod_resources: { limits: { memory: "2Ei", "ephemeral-storage": "1E" } },
    });
  });

  it("rejects a pod_resources quantity that is not a Kubernetes quantity string", () => {
    expect(() =>
      parseAgentInput({
        name: "fix-ci",
        pod_resources: { limits: { memory: "lots" } },
      }),
    ).toThrow();
  });
});

describe("parseAgentPatch", () => {
  it("keeps only the fields present in the body", () => {
    expect(parseAgentPatch({ model: "claude-haiku-4-5-20251001" })).toEqual({
      model: "claude-haiku-4-5-20251001",
    });
  });

  it("carries pod_resources when present and omits it when absent", () => {
    expect(
      parseAgentPatch({
        pod_resources: {
          requests: { cpu: "500m" },
          limits: { memory: "4Gi" },
        },
      }),
    ).toEqual({
      pod_resources: { requests: { cpu: "500m" }, limits: { memory: "4Gi" } },
    });
    expect(parseAgentPatch({ model: "claude-opus-4-8" })).not.toHaveProperty(
      "pod_resources",
    );
  });

  it("a null pod_resources means clear — carried as null", () => {
    expect(parseAgentPatch({ pod_resources: null })).toEqual({
      pod_resources: null,
    });
  });

  it("carries every scalar field present in the body", () => {
    expect(
      parseAgentPatch({
        name: "fix-ci",
        timeout_minutes: 30,
        prompt: "Fix the failing CI job",
        image: "golang:1.23",
        execution_mode: "station",
        review_required: true,
      }),
    ).toEqual({
      name: "fix-ci",
      timeout_minutes: 30,
      prompt: "Fix the failing CI job",
      image: "golang:1.23",
      execution_mode: "station",
      review_required: true,
    });
  });

  it("clears nullable fields when explicitly set to null", () => {
    expect(
      parseAgentPatch({
        model: null,
        timeout_minutes: null,
        prompt: null,
        image: null,
      }),
    ).toEqual({
      model: null,
      timeout_minutes: null,
      prompt: null,
      image: null,
    });
  });
});

describe("configWithPodResources", () => {
  it("keeps the resolved config's other keys while replacing pod_resources", () => {
    expect(
      configWithPodResources(
        {
          command: ["lore-station", "validate"],
          pod_resources: { limits: { memory: "1Gi" } },
        },
        { limits: { memory: "4Gi" } },
      ),
    ).toEqual({
      command: ["lore-station", "validate"],
      pod_resources: { limits: { memory: "4Gi" } },
    });
  });

  it("null removes pod_resources and an empty result collapses to null", () => {
    expect(
      configWithPodResources({ pod_resources: { limits: { cpu: "2" } } }, null),
    ).toBeNull();
    expect(configWithPodResources(null, null)).toBeNull();
  });

  it("null existing config plus pod_resources yields just the block", () => {
    expect(
      configWithPodResources(null, { requests: { memory: "2Gi" } }),
    ).toEqual({ pod_resources: { requests: { memory: "2Gi" } } });
  });
});

describe("imageFieldTouched", () => {
  it("flags a write that sets a non-empty image", () => {
    expect(imageFieldTouched({ image: "golang:1.23" })).toBe(true);
  });

  it("does not flag a null or empty image", () => {
    expect(imageFieldTouched({ image: null })).toBe(false);
    expect(imageFieldTouched({ image: "   " })).toBe(false);
    expect(imageFieldTouched({})).toBe(false);
  });
});
