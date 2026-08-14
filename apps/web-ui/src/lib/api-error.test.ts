import { describe, it, expect, vi, afterEach } from "vitest";
import { serverError, upstreamError } from "./api-error";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("serverError", () => {
  it("returns 500 carrying the error message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = serverError("cancel", new Error("boom"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "boom" });
  });
});

describe("upstreamError", () => {
  it("forwards the upstream status and message", async () => {
    const res = upstreamError("Cancel", {
      status: "error",
      message: "Cannot cancel task in merged state",
      code: 409,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Cannot cancel task in merged state",
    });
  });

  it("answers 500 for a transport failure that carries no status", async () => {
    const res = upstreamError("Cancel", {
      status: "error",
      message: "fetch failed",
    });

    expect(res.status).toBe(500);
  });

  it("names the missing configuration as a 500 rather than forwarding nothing", async () => {
    const res = upstreamError("Cancel", { status: "unconfigured" });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Cancel is unavailable: the web UI has no lore-api configured.",
    });
  });
});
