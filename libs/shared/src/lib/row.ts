/**
 * The field↔column binding a model declares, and the two readers that consume it.
 *
 * A model in `libs/shared/src/models/` names its table's columns once, as a map
 * from its own camelCase field to the snake_case column. Adapters then build their
 * SELECT list and map their result rows from that one declaration instead of
 * restating it — so a column the table no longer has fails as a SQL error on a
 * generated list, rather than as a silently `undefined` field.
 */

/** Every field of `T`, bound to the column that stores it. */
export type ColumnMap<T> = Record<keyof T, string>;

/** A result row as the driver hands it back: column name → value. */
export type DbRow = Record<string, unknown>;

/**
 * The SELECT list for a model, in declaration order. `alias` qualifies every
 * column, which a join needs and an unqualified read does not.
 */
export function selectList<T>(columns: ColumnMap<T>, alias?: string): string {
  const qualify = alias ? (column: string) => `${alias}.${column}` : String;

  return Object.values<string>(columns).map(qualify).join(", ");
}

/**
 * One result row as the model. Columns the map does not name are dropped, so a
 * query may select extras (a join's cost, a window's rank) without them leaking
 * into the record.
 *
 * NAME the model — `fromRow<Repo>(REPO_COLUMNS, row)`. A `ColumnMap<T>` carries
 * only `T`'s keys, so inference alone would hand back every field as `unknown`.
 */
export function fromRow<T>(columns: ColumnMap<T>, row: DbRow): T {
  const record = {} as Record<keyof T, unknown>;

  for (const [field, column] of Object.entries<string>(columns) as Array<
    [keyof T, string]
  >) {
    record[field] = row[column];
  }

  return record as T;
}

/**
 * A projection of a column map: the named fields, in the order named.
 *
 * A read that wants some of a table's columns still derives them from the one
 * declaration, so a projection cannot name a column the model does not have.
 */
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

/**
 * The inverse of {@link fromRow}: one model keyed by the columns that store it.
 *
 * Used where a body publishes the STORED spelling — several clients read
 * snake_case, and flipping any of them is expand/contract work across images
 * rather than a rename, so the model stays camelCase inside and the wire keeps
 * its own keys.
 */
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

/** Type-only: `Assert<Check>` fails `tsc` when `Check` is not `true`. */
export type Assert<Check extends true> = Check;

/**
 * Type-only: every key of `Shape` is a column that `Columns` binds.
 *
 * The guard for a hand-written row shape that a model already describes — a
 * pg adapter's result type, an in-memory double's stored row, a wire body.
 * Pairing it with {@link Assert} turns "this shape is the table's shape" from a
 * comment into a build failure, which is what catches a column renamed out from
 * under a `SELECT` before it reaches production as a `42703`.
 *
 * Keys the shape carries DELIBERATELY that are not columns — a joined-in owner,
 * an aggregate — go in an `Omit` at the call site, so the exceptions are a list
 * someone has to write down rather than a paragraph someone has to believe.
 */
export type KeysAreColumns<Shape, T, Columns extends ColumnMap<T>> =
  Exclude<keyof Shape, Columns[keyof T]> extends never ? true : false;
