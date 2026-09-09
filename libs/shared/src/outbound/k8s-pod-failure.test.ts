import { describe, it, expect } from "vitest";
import { isTransientInfraFailure } from "./k8s-pod-failure.js";

describe("isTransientInfraFailure", () => {
  it("classifies BackoffLimitExceeded as transient infra", () => {
    expect(
      isTransientInfraFailure(
        "BackoffLimitExceeded: Job has reached the specified backoff limit",
      ),
    ).toBe(true);
  });

  it("classifies CreateContainerConfigError as transient infra", () => {
    expect(isTransientInfraFailure("CreateContainerConfigError")).toBe(true);
  });

  it("does not classify a validation failure as transient infra", () => {
    expect(
      isTransientInfraFailure("validation failed: tsc reported 3 errors"),
    ).toBe(false);
  });

  it("returns false for a missing reason", () => {
    expect(isTransientInfraFailure(undefined)).toBe(false);
  });
});
