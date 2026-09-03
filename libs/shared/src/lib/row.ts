// The field↔column binding a model declares (one map per table), and the readers that consume it — a dropped column fails as a SQL error, not a silent `undefined`.

/** Every field of `T`, bound to the column that stores it. */
export type ColumnMap<T> = Record<keyof T, string>;

/** A result row as the driver hands it back: column name → value. */
export type DbRow = Record<string, unknown>;

// The SELECT list for a model, in declaration order; `alias` qualifies every column for a join.
export function selectList<T>(columns: ColumnMap<T>, alias?: string): string {
  const qualify = alias ? (column: string) => `${alias}.${column}` : String;

  return Object.values<string>(columns).map(qualify).join(", ");
}

// One result row as the model (unnamed columns dropped, so a query may select extras). NAME the model explicitly — `fromRow<Repo>(REPO_COLUMNS, row)` — since inference alone yields `unknown` fields.
export function fromRow<T>(columns: ColumnMap<T>, row: DbRow): T {
  const record = {} as Record<keyof T, unknown>;

  for (const [field, column] of Object.entries<string>(columns) as Array<
    [keyof T, string]
  >) {
    record[field] = row[column];
  }

  return record as T;
}

// A projection of a column map, in the order named — a projection cannot name a column the model does not have.
export function pickColumns<T, K extends keyof T>(
  columns: ColumnMap<T>,
  fields: readonly K[],
): ColumnMap<Pick<T, K>> {
  const picked = {} as ColumnMap<Pick<T, K>>;

  for (const field of fields) {
    picked[field] = columns[field];
  }

  return picked;
}

// Inverse of {@link fromRow}: one model keyed by its stored columns, for wire bodies that publish the snake_case spelling while the model stays camelCase inside.
export function toRow<T extends object>(
  columns: ColumnMap<T>,
  record: T,
): DbRow {
  const row: DbRow = {};

  for (const [field, column] of Object.entries<string>(columns) as Array<
    [keyof T, string]
  >) {
    row[column] = record[field];
  }

  return row;
}

// Reader half of an expand/contract rename (specs/6-dark-factory FR6.41): accepts either camelCase field or snake_case column spelling, always outputs keyed by COLUMN (column wins if both present), so a producer can flip spelling in a later release without a coordinated deploy.
export function acceptEitherSpelling<T>(
  columns: ColumnMap<T>,
  raw: DbRow,
): DbRow {
  const row: DbRow = {};

  for (const [field, column] of Object.entries<string>(columns) as Array<
    [keyof T & string, string]
  >) {
    if (column in raw) {
      row[column] = raw[column];
      continue;
    }

    if (field in raw) {
      row[column] = raw[field];
    }
  }

  return row;
}

/** Type-only: `Assert<Check>` fails `tsc` when `Check` is not `true`. */
export type Assert<Check extends true> = Check;

// Type-only guard: every key of `Shape` is a column `Columns` binds, catching a renamed column at build time instead of a `42703` in production. Requires `Columns` pinned with `as const` — without it the assertion always answers `true`.
export type KeysAreColumns<Shape, T, Columns extends ColumnMap<T>> =
  Exclude<keyof Shape, Columns[keyof T]> extends never ? true : false;
