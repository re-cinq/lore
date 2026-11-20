import { describe, it, expect } from "vitest";
import { parseBumpClassification } from "./bump-classification.js";

describe("parseBumpClassification", () => {
  it("returns a minor bump for the object with bump minor", () => {
    expect(parseBumpClassification('{"bump":"minor"}')).toEqual({
      ok: true,
      bump: "minor",
    });
  });

  it("returns a major bump for the object with bump major and a trailing newline", () => {
    expect(parseBumpClassification('{"bump":"major"}\n')).toEqual({
      ok: true,
      bump: "major",
    });
  });

  it("returns a patch bump for the object spread over lines with spaces", () => {
    expect(parseBumpClassification('{\n  "bump": "patch"\n}')).toEqual({
      ok: true,
      bump: "patch",
    });
  });

  it("refuses Minor, which is not lower case", () => {
    expect(parseBumpClassification('{"bump":"Minor"}')).toEqual({
      ok: false,
      reason: "bump must be major, minor or patch",
    });
  });

  it("refuses an empty string", () => {
    expect(parseBumpClassification("")).toEqual({
      ok: false,
      reason: "the classification is not valid JSON",
    });
  });

  it("refuses text around the object", () => {
    expect(
      parseBumpClassification('The bump is {"bump":"minor"} for this one'),
    ).toEqual({ ok: false, reason: "the classification is not valid JSON" });
  });

  it("refuses the object inside a code fence", () => {
    expect(parseBumpClassification('```json\n{"bump":"minor"}\n```')).toEqual({
      ok: false,
      reason: "the classification is not valid JSON",
    });
  });

  it("refuses an object with an extra key", () => {
    expect(
      parseBumpClassification('{"bump":"minor","reason":"new route"}'),
    ).toEqual({ ok: false, reason: "bump must be major, minor or patch" });
  });

  it("refuses an object with no bump key", () => {
    expect(parseBumpClassification("{}")).toEqual({
      ok: false,
      reason: "bump must be major, minor or patch",
    });
  });

  it("refuses the bare JSON string minor", () => {
    expect(parseBumpClassification('"minor"')).toEqual({
      ok: false,
      reason: "bump must be major, minor or patch",
    });
  });
});
