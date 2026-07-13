import { describe, it, expect } from "vitest";
import {
  parseAgentInput,
  parseAgentPatch,
  imageFieldTouched,
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
});

describe("parseAgentPatch", () => {
  it("keeps only the fields present in the body", () => {
    expect(parseAgentPatch({ model: "claude-haiku-4-5-20251001" })).toEqual({
      model: "claude-haiku-4-5-20251001",
    });
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
