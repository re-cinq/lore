import { describe, it, expect } from "vitest";
import {
  resolveExecutionImage,
  DEFAULT_EXECUTION_IMAGE,
} from "./dark-factory-settings.js";

describe("resolveExecutionImage", () => {
  it("returns the default image when no execution settings are present", () => {
    expect(resolveExecutionImage({}, "implementation")).toBe(
      DEFAULT_EXECUTION_IMAGE,
    );
  });

  it("returns the default image when settings is null", () => {
    expect(resolveExecutionImage(null, "implementation")).toBe(
      DEFAULT_EXECUTION_IMAGE,
    );
  });

  it("returns the per-repo image from dark_factory.execution.image", () => {
    const settings = { dark_factory: { execution: { image: "golang:1.23" } } };
    expect(resolveExecutionImage(settings, "implementation")).toBe(
      "golang:1.23",
    );
  });

  it("returns the per-task-type image over the per-repo image", () => {
    const settings = {
      dark_factory: { execution: { image: "golang:1.23" } },
      task_overrides: {
        implementation: { execution: { image: "golang:1.23-toolchain" } },
      },
    };
    expect(resolveExecutionImage(settings, "implementation")).toBe(
      "golang:1.23-toolchain",
    );
  });

  it("applies a per-task-type image only to its own task type", () => {
    const settings = {
      dark_factory: { execution: { image: "golang:1.23" } },
      task_overrides: {
        implementation: { execution: { image: "golang:1.23-toolchain" } },
      },
    };
    expect(resolveExecutionImage(settings, "gap-fill")).toBe("golang:1.23");
  });
});
