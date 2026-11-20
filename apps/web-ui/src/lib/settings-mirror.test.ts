import { describe, it, expect } from "vitest";
import { parsePublicMirror } from "./settings-mirror";

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();

  for (const [name, value] of Object.entries(fields)) {
    formData.set(name, value);
  }

  return formData;
}

describe("parsePublicMirror", () => {
  it("answers acme/public when the field holds acme/public and none is saved", () => {
    expect(
      parsePublicMirror(form({ public_mirror: "acme/public" }), null),
    ).toBe("acme/public");
  });

  it("trims the spaces around acme/public", () => {
    expect(
      parsePublicMirror(form({ public_mirror: "  acme/public " }), undefined),
    ).toBe("acme/public");
  });

  it("answers null when the field is emptied while acme/public is saved", () => {
    expect(parsePublicMirror(form({ public_mirror: "" }), "acme/public")).toBe(
      null,
    );
  });

  it("answers undefined when the field still holds the saved acme/public", () => {
    expect(
      parsePublicMirror(form({ public_mirror: "acme/public" }), "acme/public"),
    ).toBe(undefined);
  });

  it("answers undefined when the field is empty and none is saved", () => {
    expect(parsePublicMirror(form({ public_mirror: "" }), null)).toBe(
      undefined,
    );
  });

  it("answers undefined when the form has no public mirror field", () => {
    expect(parsePublicMirror(form({}), "acme/public")).toBe(undefined);
  });
});
