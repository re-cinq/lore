import type { ServerRoute } from "@hapi/hapi";
import { getZodSchema } from "../http/zod-validate.js";
import {
  optionsOf,
  toRequestSchema,
  type JsonSchema,
} from "./operation-responses.js";

/** One `in: query` parameter per property of the route's zod query schema, so a generated client types the query a route reads. */
export function queryParameters(route: ServerRoute): JsonSchema[] {
  const validate = optionsOf(route).validate as { query?: unknown } | undefined;
  const schema = getZodSchema(validate?.query);

  if (!schema) {
    return [];
  }
  const { properties = {}, required = [] } = toRequestSchema(schema) as {
    properties?: Record<string, JsonSchema>;
    required?: string[];
  };

  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: "query",
    required: required.includes(name),
    schema: property,
  }));
}
