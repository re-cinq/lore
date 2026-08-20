import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ZodRawShape, ZodTypeAny } from "zod";
import { REPO_COLUMNS, REPO_TABLE } from "./repo.js";

/**
 * The guard over every model in this folder. A model binds a table's columns to
 * its own camelCase fields, and nothing but this test checks that the binding is
 * total — a field with no column reads `undefined` forever, and a column the map
 * spells wrong only fails once that query runs in production.
 *
 * It DISCOVERS the models by reading the directory rather than taking a
 * registry, so a file added without a line here is still covered. Files that
 * export no `*_COLUMNS` are value shapes (a JSONB document, an enum) rather than
 * tables, and are held to the one rule that still applies: they claim no table.
 */

const modelsDir = dirname(fileURLToPath(import.meta.url));

/** Fields of the schema that the column map does not bind. */
export function unboundFields(
  shape: ZodRawShape,
  columns: Record<string, string>,
): string[] {
  return Object.keys(shape).filter((field) => !(field in columns));
}

/** Columns bound to no field of the schema — a map that outlived its model. */
export function strayColumns(
  shape: ZodRawShape,
  columns: Record<string, string>,
): string[] {
  return Object.keys(columns).filter((field) => !(field in shape));
}

/** Column names Postgres would need quoting for; a model must never need it. */
export function nonSnakeColumns(columns: Record<string, string>): string[] {
  return Object.values(columns).filter((c) => !/^[a-z][a-z0-9_]*$/.test(c));
}

interface ModelModule {
  [name: string]: unknown;
}

interface TableModel {
  file: string;
  table: string;
  shape: ZodRawShape;
  columns: Record<string, string>;
}

/**
 * Discovery accepts either extension, keyed by STEM so a directory holding both
 * yields each model once. `dist/**` is excluded from this suite, so today the
 * sweep only ever sees `.ts` — but pinning it to that extension made the sweep
 * silently find nothing anywhere else, which is a worse failure than a wrong
 * answer: it reports success over an empty set.
 */
const files = [
  ...new Map(
    readdirSync(modelsDir)
      .filter(
        (f) =>
          (f.endsWith(".ts") || f.endsWith(".js")) &&
          !/\.test\.[tj]s$/.test(f) &&
          !f.endsWith(".d.ts"),
      )
      .sort()
      .map((f) => [f.replace(/\.[tj]s$/, ""), f] as const),
  ).values(),
].sort();

const loaded: Array<[string, ModelModule]> = await Promise.all(
  files.map(
    async (f) =>
      [f, (await import(join(modelsDir, f))) as ModelModule] as [
        string,
        ModelModule,
      ],
  ),
);

function columnsKey(mod: ModelModule): string | undefined {
  return Object.keys(mod).find((k) => k.endsWith("_COLUMNS"));
}

function columnsOf(mod: ModelModule): Record<string, string> | undefined {
  const key = columnsKey(mod);

  return key ? (mod[key] as Record<string, string>) : undefined;
}

/**
 * The schema name a column map implies: `ASSEMBLY_RUN_COLUMNS` → `AssemblyRunSchema`.
 *
 * Derived rather than "the first export ending in Schema", which quietly picked a
 * model's status ENUM — it has no `.shape`, so the model dropped out of the sweep
 * and reported nothing while looking covered.
 */
export function schemaNameFor(columnsExport: string): string {
  const pascal = columnsExport
    .replace(/_COLUMNS$/, "")
    .toLowerCase()
    .replace(/(^|_)([a-z])/g, (_m, _sep, c: string) => c.toUpperCase());

  return `${pascal}Schema`;
}

function shapeOf(mod: ModelModule): ZodRawShape | undefined {
  const key = columnsKey(mod);
  const schema = key
    ? (mod[schemaNameFor(key)] as
        (ZodTypeAny & { shape?: ZodRawShape }) | undefined)
    : undefined;

  return schema?.shape;
}

/** Files that declare a table but whose schema the sweep could not resolve. */
const unreadable: string[] = [];

const tableModels: TableModel[] = loaded.flatMap(([file, mod]) => {
  const columns = columnsOf(mod);
  const tableKey = Object.keys(mod).find((k) => k.endsWith("_TABLE"));

  if (!columns || !tableKey) {
    return [];
  }
  const shape = shapeOf(mod);

  if (!shape) {
    unreadable.push(file);

    return [];
  }

  return [{ file, table: mod[tableKey] as string, shape, columns }];
});

describe("the models folder", () => {
  it("discovers the repo model, so the sweep is reaching real files", () => {
    const repo = tableModels.find((m) => m.table === REPO_TABLE);

    expect(repo?.columns).toEqual(REPO_COLUMNS);
  });

  it("resolves the schema of every table model, so none escapes the sweep", () => {
    expect(unreadable).toEqual([]);
  });

  it("gives every table model a distinct table", () => {
    const tables = tableModels.map((m) => m.table);

    expect(tables).toEqual([...new Set(tables)]);
  });

  it("leaves no value-shape file claiming a table", () => {
    const claiming = loaded
      .filter(([, mod]) => !columnsOf(mod))
      .filter(([, mod]) => Object.keys(mod).some((k) => k.endsWith("_TABLE")))
      .map(([file]) => file);

    expect(claiming).toEqual([]);
  });
});

describe.each(tableModels.map((m) => [m.file, m] as const))(
  "%s",
  (_file, model) => {
    it("binds a column to every field of its schema", () => {
      expect(unboundFields(model.shape, model.columns)).toEqual([]);
    });

    it("binds no column its schema does not declare", () => {
      expect(strayColumns(model.shape, model.columns)).toEqual([]);
    });

    it("names every column in unquoted snake_case", () => {
      expect(nonSnakeColumns(model.columns)).toEqual([]);
    });
  },
);

describe("the guard itself", () => {
  const shape = { fullName: {}, team: {} } as unknown as ZodRawShape;

  it("reports a field the column map forgot", () => {
    expect(unboundFields(shape, { fullName: "full_name" })).toEqual(["team"]);
  });

  it("reports a column bound to no field", () => {
    expect(
      strayColumns(shape, {
        fullName: "full_name",
        team: "team",
        gone: "gone",
      }),
    ).toEqual(["gone"]);
  });

  it("reports a camelCase column name", () => {
    expect(nonSnakeColumns({ fullName: "fullName" })).toEqual(["fullName"]);
  });

  it("derives AssemblyRunSchema from ASSEMBLY_RUN_COLUMNS", () => {
    expect(schemaNameFor("ASSEMBLY_RUN_COLUMNS")).toBe("AssemblyRunSchema");
  });
});
