import { describe, it, expect } from "vitest";
import { toApiResult, enforceOk } from "./result";

describe("toApiResult", () => {
  it("returns the parsed body for a 2xx", async () => {
    expect(
      await toApiResult(new Response(JSON.stringify({ id: "f1" }))),
    ).toEqual({ status: "ok", data: { id: "f1" } });
  });

  it("carries the body's error field for a 4xx", async () => {
    expect(
      await toApiResult(
        new Response(JSON.stringify({ error: "feature not found" }), {
          status: 404,
        }),
      ),
    ).toEqual({
      status: "error",
      message: "feature not found",
      code: 404,
      body: { error: "feature not found" },
    });
  });

  it("falls back to the status when the body names no reason", async () => {
    expect(await toApiResult(new Response("{}", { status: 500 }))).toEqual({
      status: "error",
      message: "HTTP 500",
      code: 500,
      body: {},
    });
  });

  it("treats an unparseable body as empty rather than throwing, since a 502 from a proxy is HTML", async () => {
    expect(
      await toApiResult(new Response("<html>bad gateway", { status: 502 })),
    ).toEqual({ status: "error", message: "HTTP 502", code: 502, body: {} });
  });
});

describe("toApiResult error body", () => {
  it("carries the parsed body so a caller can read fields beyond the message, e.g. which task blocked an onboard guard's 409", async () => {
    const res = await toApiResult(
      new Response(
        JSON.stringify({
          error: "already in flight",
          blocked: "in-flight",
          task_id: "t7",
        }),
        { status: 409 },
      ),
    );

    expect(res).toMatchObject({
      status: "error",
      message: "already in flight",
      code: 409,
      body: { blocked: "in-flight", task_id: "t7" },
    });
  });
});

describe("enforceOk", () => {
  it("returns the data for an ok result", () => {
    expect(enforceOk("Create", { status: "ok", data: { id: "f1" } })).toEqual({
      id: "f1",
    });
  });

  it("throws naming the action and the missing configuration", () => {
    expect(() =>
      enforceOk("Create feature", { status: "unconfigured" }),
    ).toThrow(/Create feature is unavailable.*LORE_API_URL/);
  });

  it("throws naming the action and the upstream message, rather than resolving as a silent no-op", () => {
    expect(() =>
      enforceOk("Refine", { status: "error", message: "409 round in flight" }),
    ).toThrow("Refine failed: 409 round in flight");
  });
});
