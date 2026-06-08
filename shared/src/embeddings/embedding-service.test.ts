import { describe, it, expect } from "vitest";
import { buildVertexUrl } from "./embedding-service.js";

describe("buildVertexUrl", () => {
  it("interpolates project and region into the predict endpoint", () => {
    expect(buildVertexUrl("my-gcp-project", "europe-west1")).toBe(
      "https://europe-west1-aiplatform.googleapis.com/v1/projects/my-gcp-project/locations/europe-west1/publishers/google/models/text-embedding-005:predict",
    );
  });

  it("yields a projects// double slash when project is empty", () => {
    expect(buildVertexUrl("", "europe-west1")).toContain("projects//locations");
  });
});
