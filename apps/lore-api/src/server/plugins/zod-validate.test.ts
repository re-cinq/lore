import { describe, it, expect } from "vitest";
import type { Request, ResponseToolkit } from "@hapi/hapi";
import { z } from "zod";
import {
  zodValidate,
  getZodSchema,
  zodFailAction,
  formatZodError,
} from "./zod-validate.js";

const stubRequest = {} as Request;
const stubToolkit = {} as ResponseToolkit;

describe("zodValidate", () => {
  const schema = z.object({ name: z.string(), count: z.coerce.number() });

  it("returns typed coerced data for a valid value", async () => {
    const data = await zodValidate(schema)({ name: "ci", count: "3" });

    expect(data).toEqual({ name: "ci", count: 3 });
  });

  it("throws with the offending field named for an invalid value", async () => {
    await expect(zodValidate(schema)({ count: "3" })).rejects.toThrow(
      "name: Required",
    );
  });

  it("stamps the source schema onto the returned fn for getZodSchema to recover", () => {
    expect(getZodSchema(zodValidate(schema))).toBe(schema);
  });
});

describe("getZodSchema", () => {
  it("returns undefined for a validator not built by zodValidate", () => {
    expect(getZodSchema(async (v: unknown) => v)).toBeUndefined();
    expect(getZodSchema(true)).toBeUndefined();
    expect(getZodSchema(undefined)).toBeUndefined();
  });
});

describe("formatZodError", () => {
  it("names the first offending field with a dotted path", () => {
    const err = z
      .object({ a: z.object({ b: z.string() }) })
      .safeParse({ a: {} });

    expect(err.success).toBe(false);

    if (!err.success) {
      expect(formatZodError(err.error)).toBe("a.b: Required");
    }
  });

  it("falls back to invalid request with no issues", () => {
    expect(formatZodError({ issues: [] } as unknown as z.ZodError)).toBe(
      "invalid request",
    );
  });
});

describe("zodFailAction", () => {
  it("throws a 400 Boom carrying the error message as the { error } body", () => {
    try {
      zodFailAction(stubRequest, stubToolkit, new Error("name: Required"));
      throw new Error("did not throw");
    } catch (err) {
      const boom = err as {
        isBoom?: boolean;
        output?: { statusCode: number; payload: unknown };
      };

      expect(boom.isBoom).toBe(true);
      expect(boom.output).toMatchObject({
        statusCode: 400,
        payload: { error: "name: Required" },
      });
    }
  });
});
