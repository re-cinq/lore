import { describe, it, expect } from "vitest";
import {
  badgeClassForType,
  labelForType,
  orderTypes,
  contextHref,
} from "./content-types";

describe("badgeClassForType", () => {
  it("returns a color modifier for known types", () => {
    expect(badgeClassForType("spec")).toEqual("badge badge-green");
    expect(badgeClassForType("code")).toEqual("badge badge-gray");
    expect(badgeClassForType("adr")).toEqual("badge badge-yellow");
  });

  it("falls back to the plain badge class for unknown types", () => {
    expect(badgeClassForType("mystery")).toEqual("badge");
  });
});

describe("labelForType", () => {
  it("turns underscores into spaces", () => {
    expect(labelForType("pull_request")).toEqual("pull request");
  });

  it("leaves a single-word type unchanged", () => {
    expect(labelForType("doc")).toEqual("doc");
  });
});

describe("orderTypes", () => {
  it("orders known types by the canonical order regardless of input order", () => {
    expect(orderTypes(["code", "adr", "doc", "spec"])).toEqual([
      "doc",
      "spec",
      "adr",
      "code",
    ]);
  });

  it("sorts unknown types after known ones, alphabetically", () => {
    expect(orderTypes(["zeta", "code", "alpha"])).toEqual([
      "code",
      "alpha",
      "zeta",
    ]);
  });
});

describe("contextHref", () => {
  it("returns the base path when no type or query", () => {
    expect(contextHref("/context")).toEqual("/context");
  });

  it("encodes the type filter", () => {
    expect(contextHref("/context", "spec")).toEqual("/context?type=spec");
  });

  it("combines type and query", () => {
    expect(contextHref("/context", "spec", "hello world")).toEqual(
      "/context?type=spec&q=hello+world",
    );
  });

  it("emits only the query when no type", () => {
    expect(contextHref("/repos/o/r/context", undefined, "foo")).toEqual(
      "/repos/o/r/context?q=foo",
    );
  });
});
