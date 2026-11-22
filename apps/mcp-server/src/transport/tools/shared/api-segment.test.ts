import { describe, it, expect } from "vitest";
import { apiSegment, idParam } from "./api-segment.js";
import { runPath } from "../runs/shared/run-read.js";

const HOSTILE = [
  "x/../../repos/a/b/webhook/secret?",
  "x#",
  "x?y=1",
  "x\\y",
  "x%2Fy",
  "%2e%2e",
  "..%2f..",
  "x\r\ny",
];

describe("apiSegment", () => {
  it("leaves an ordinary id as it is", () => {
    expect(apiSegment("b4b2026f-1111-2222-3333-444455556666")).toBe(
      "b4b2026f-1111-2222-3333-444455556666",
    );
  });

  it.each(HOSTILE)("keeps %j inside one path segment", (id) => {
    const url = new URL(
      `https://lore-api.example.com/api/things/${apiSegment(id)}/view`,
    );

    expect({
      segments: url.pathname.split("/").length,
      start: url.pathname.startsWith("/api/things/"),
      end: url.pathname.endsWith("/view"),
      search: url.search,
      hash: url.hash,
    }).toEqual({ segments: 5, start: true, end: true, search: "", hash: "" });
  });

  it.each([".", "..", ""])(
    "refuses %j, which encoding cannot contain",
    (id) => {
      expect(() => apiSegment(id)).toThrow("an id was expected, not a path");
    },
  );

  it("is what a run's path is built with", () => {
    expect(() => runPath("..", "/events")).toThrow(
      "an id was expected, not a path",
    );
  });
});

describe("idParam", () => {
  it.each([".", "..", ""])("refuses %j", (id) => {
    expect(idParam.safeParse(id).success).toBe(false);
  });

  it("accepts an id", () => {
    expect(
      idParam.safeParse("b4b2026f-1111-2222-3333-444455556666").success,
    ).toBe(true);
  });
});
