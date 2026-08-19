import { z } from "zod";
import type { ColumnMap } from "./row.js";

/**
 * The wire projection of a model: the same fields, keyed by the COLUMNS that
 * store them.
 *
 * Several surfaces publish a row under its snake_case column names — that is
 * what the deployed clients read, and flipping any of them is expand/contract
 * work rather than a rename. Restating the shape per surface is how those copies
 * drift; deriving it from the model plus its column map means the wire contract
 * and the table cannot disagree about which fields exist.
 *
 * Timestamps stay `z.date()`. The OpenAPI generator renders that as a
 * `date-time` STRING, which is exactly what JSON carries and what the generated
 * client should therefore see — so one declaration produces the right type on
 * both sides.
 */
export function wireSchema<
  Shape extends z.ZodRawShape,
  Columns extends ColumnMap<z.infer<z.ZodObject<Shape>>>,
>(
  schema: z.ZodObject<Shape>,
  columns: Columns,
): z.ZodObject<{
  [K in keyof Shape as Columns[K & keyof Columns] & string]: Shape[K];
}> {
  const renamed: z.ZodRawShape = {};

  for (const [field, value] of Object.entries(schema.shape)) {
    const column = (columns as Record<string, string>)[field];

    renamed[column ?? field] = value as z.ZodTypeAny;
  }

  return z.object(renamed) as z.ZodObject<{
    [K in keyof Shape as Columns[K & keyof Columns] & string]: Shape[K];
  }>;
}
