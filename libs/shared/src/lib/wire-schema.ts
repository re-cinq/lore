import { z } from "zod";
import { enforceTrue } from "./enforce.js";
import type { ColumnMap } from "./row.js";

/** The wire projection of a model: fields keyed by their snake_case COLUMNS, derived from the model + column map so wire contract and table cannot drift out of sync; timestamps stay `z.date()` so OpenAPI renders the `date-time` string JSON actually carries. */
export function wireSchema<
  Shape extends z.ZodRawShape,
  Columns extends ColumnMap<z.infer<z.ZodObject<Shape>>>,
>(
  schema: z.ZodObject<Shape>,
  columns: Columns,
): z.ZodObject<{
  [K in keyof Shape as Columns[K & keyof Columns] & string]: Shape[K];
}> {
  const renamed = renameFieldsToColumns(
    schema,
    columns as Record<string, string | undefined>,
  );

  // The rename is by construction, not by inference: zod 4 widens the built shape to a string index signature, so the declared return type is reasserted here.
  return z.object(renamed) as unknown as z.ZodObject<{
    [K in keyof Shape as Columns[K & keyof Columns] & string]: Shape[K];
  }>;
}

/** Rekeys a model's shape by its bound columns; a field with no binding is an error, never a silent fallback to the field name, because defaulting would publish a wrong contract. */
function renameFieldsToColumns<Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
  columns: Record<string, string | undefined>,
): Record<string, z.ZodType> {
  const renamed: Record<string, z.ZodType> = {};

  for (const [field, value] of Object.entries(schema.shape)) {
    const column = columns[field];

    enforceTrue(
      column !== undefined,
      Error,
      `wireSchema: no column bound for field "${String(field)}"`,
    );
    renamed[column] = value as z.ZodType;
  }

  return renamed;
}

/** The plain TS shape `wireSchema` would infer, for callers that only want a snake_case-keyed type — typically `Pick<WireOf<...>, "a_column" | "b_column">` for a hand-written projection query. */
export type WireOf<
  Shape extends z.ZodRawShape,
  Columns extends ColumnMap<z.infer<z.ZodObject<Shape>>>,
> = z.infer<ReturnType<typeof wireSchema<Shape, Columns>>>;
