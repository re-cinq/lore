import { describe, it, expect } from "vitest";
import { trimmedFormField, createFeatureErrorMessage } from "./action-input";

describe("trimmedFormField", () => {
  it("trims surrounding whitespace off a present field", () => {
    const formData = new FormData();

    formData.set("title", "  Ship the thing  ");

    expect(trimmedFormField(formData, "title")).toBe("Ship the thing");
  });

  it("returns an empty string when the field is absent", () => {
    const formData = new FormData();

    expect(trimmedFormField(formData, "title")).toBe("");
  });
});

describe("createFeatureErrorMessage", () => {
  it("names the missing configuration when the API is unconfigured", () => {
    expect(createFeatureErrorMessage({ status: "unconfigured" })).toBe(
      "Feature API is not configured (LORE_API_URL / token).",
    );
  });

  it("passes through the result's own error message otherwise", () => {
    expect(
      createFeatureErrorMessage({ status: "error", message: "not found" }),
    ).toBe("not found");
  });
});
