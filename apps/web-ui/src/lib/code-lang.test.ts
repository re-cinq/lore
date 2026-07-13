import { describe, it, expect } from "vitest";
import { languageForPath, fenceFor } from "./code-lang";

describe("languageForPath", () => {
  it("maps .ts and .tsx to typescript", () => {
    expect(languageForPath("a/b.ts")).toEqual("typescript");
    expect(languageForPath("a/b.tsx")).toEqual("typescript");
  });

  it("maps .py to python and .go to go", () => {
    expect(languageForPath("x.py")).toEqual("python");
    expect(languageForPath("x.go")).toEqual("go");
  });

  it("maps a bare Dockerfile (no extension) to dockerfile", () => {
    expect(languageForPath("docker/Dockerfile")).toEqual("dockerfile");
  });

  it("is case-insensitive on the extension", () => {
    expect(languageForPath("A/B.TS")).toEqual("typescript");
  });

  it("returns empty string for an unknown extension", () => {
    expect(languageForPath("a/b.xyz")).toEqual("");
  });

  it("returns empty string when the file has no extension", () => {
    expect(languageForPath("Makefile")).toEqual("");
  });
});

describe("fenceFor", () => {
  it("returns three backticks for content with no backticks", () => {
    expect(fenceFor("const x = 1;")).toEqual("```");
  });

  it("lengthens the fence past the longest embedded backtick run", () => {
    expect(fenceFor("a ``` b")).toEqual("````");
    expect(fenceFor("a ```` b")).toEqual("`````");
  });
});
