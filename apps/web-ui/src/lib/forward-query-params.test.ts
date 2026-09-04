import { describe, it, expect } from "vitest";
import { forwardQueryParams } from "./forward-query-params";

describe("forwardQueryParams", () => {
  it("copies a present key from incoming onto upstream", () => {
    const incoming = new URL("http://ui/x?after=42");
    const upstream = new URL("http://floor/api/agent-events/run-1");

    forwardQueryParams(incoming, upstream, ["after", "limit"]);

    expect(upstream.searchParams.get("after")).toEqual("42");
    expect(upstream.searchParams.has("limit")).toBe(false);
  });

  it("leaves upstream untouched when none of the keys are present", () => {
    const incoming = new URL("http://ui/x");
    const upstream = new URL("http://floor/api/agent-events/run-1");

    forwardQueryParams(incoming, upstream, ["after", "limit"]);

    expect(upstream.search).toEqual("");
  });
});
