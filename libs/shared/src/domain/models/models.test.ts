import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ZodRawShape, ZodTypeAny } from "zod";
import { REPO_COLUMNS, REPO_TABLE } from "./repo.js";

const modelsDir = dirname(fileURLToPath(import.meta.url));

export function unboundFields(
  shape: ZodRawShape,
  columns: Record<string, string>,
): string[] {
  return Object.keys(shape).filter((field) => !(field in columns));
}

export function strayColumns(
  shape: ZodRawShape,
  columns: Record<string, string>,
): string[] {
  return Object.keys(columns).filter((field) => !(field in shape));
}

export function unpinnedColumnMaps(source: string): string[] {
  return source
    .split(/(?:^|\n)export const /)
    .slice(1)
    .map((declaration) => declaration.split(/\nexport /)[0])
    .filter((declaration) => /^\w+_COLUMNS\s*=/.test(declaration))
    .filter(
      (declaration) => !/\}\s*as const satisfies ColumnMap</.test(declaration),
    )
    .map((declaration) => declaration.split(/\s*=/)[0]);
}

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
  source: string;
}

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

  return [
    {
      file,
      table: mod[tableKey] as string,
      shape,
      columns,
      source: readFileSync(join(modelsDir, file), "utf-8"),
    },
  ];
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

    it("pins its column map with as const, so the type guard still inspects it", () => {
      expect(unpinnedColumnMaps(model.source)).toEqual([]);
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

  it("reports a column map declared without as const", () => {
    expect(
      unpinnedColumnMaps(
        'export const REPO_COLUMNS = {\n  id: "id",\n} satisfies ColumnMap<Repo>;\n',
      ),
    ).toEqual(["REPO_COLUMNS"]);
  });

  it("accepts a column map pinned with as const", () => {
    expect(
      unpinnedColumnMaps(
        'export const REPO_COLUMNS = {\n  id: "id",\n} as const satisfies ColumnMap<Repo>;\n',
      ),
    ).toEqual([]);
  });

  it("derives AssemblyRunSchema from ASSEMBLY_RUN_COLUMNS", () => {
    expect(schemaNameFor("ASSEMBLY_RUN_COLUMNS")).toBe("AssemblyRunSchema");
  });
});
