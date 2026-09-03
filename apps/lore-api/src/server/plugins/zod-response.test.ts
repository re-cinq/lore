import { describe, it, expect } from "vitest";
import { z } from "zod";
import { bearerScope } from "./bearer-scope.js";
import { zodResponse, getResponseMeta } from "./zod-response.js";

const Body = z.object({ ok: z.literal(true) });

describe("zodResponse", () => {
  it("preserves the auth scope it is merged onto", () => {
    const options = zodResponse(bearerScope("read"), Body, { name: "Ok" });

    expect(options.auth).toBe("bearer-scope");
    expect(
      (options.plugins as Record<string, { scope?: string }>)["bearer-scope"]
        .scope,
    ).toBe("read");
  });

  it("round-trips the schema through the plugins bag", () => {
    const options = zodResponse(bearerScope("read"), Body, { name: "Ok" });

    expect(getResponseMeta(options.plugins)?.schema).toBe(Body);
  });

  it("defaults to a described 200 with no extra error statuses", () => {
    const meta = getResponseMeta(
      zodResponse(bearerScope("read"), Body, { name: "Ok" }).plugins,
    );

    expect(meta).toMatchObject({
      name: "Ok",
      status: 200,
      description: "Successful response",
      errors: [],
    });
  });

  it("carries an explicit status and declared error statuses", () => {
    const meta = getResponseMeta(
      zodResponse(bearerScope("write"), Body, {
        name: "RoundStarted",
        status: 202,
        errors: [400, 404, 409],
      }).plugins,
    );

    expect(meta).toMatchObject({ status: 202, errors: [400, 404, 409] });
  });

  it("reports nothing for a route that declared no response", () => {
    expect(getResponseMeta(bearerScope("read").plugins)).toBeUndefined();
    expect(getResponseMeta(undefined)).toBeUndefined();
  });
});
