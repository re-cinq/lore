import { describe, it, expect } from "vitest";
import {
  selectList,
  fromRow,
  toRow,
  pickColumns,
  type ColumnMap,
  type Assert,
  type KeysAreColumns,
} from "./row.js";

interface Repo {
  id: string;
  fullName: string;
  lastIngestedAt: Date | null;
}

const REPO_COLUMNS = {
  id: "id",
  fullName: "full_name",
  lastIngestedAt: "last_ingested_at",
} as const satisfies ColumnMap<Repo>;

describe("selectList", () => {
  it("returns the mapped column names in declaration order", () => {
    expect(selectList(REPO_COLUMNS)).toBe("id, full_name, last_ingested_at");
  });

  it("prefixes every column when given a table alias", () => {
    expect(selectList(REPO_COLUMNS, "r")).toBe(
      "r.id, r.full_name, r.last_ingested_at",
    );
  });
});

describe("fromRow", () => {
  it("maps snake_case columns onto the model's camelCase fields", () => {
    const row = {
      id: "abc",
      full_name: "re-cinq/lore",
      last_ingested_at: null,
    };

    expect(fromRow(REPO_COLUMNS, row)).toEqual({
      id: "abc",
      fullName: "re-cinq/lore",
      lastIngestedAt: null,
    });
  });

  it("drops columns the query returned but the model does not declare", () => {
    const row = {
      id: "abc",
      full_name: "re-cinq/lore",
      last_ingested_at: null,
      cost_usd: 4,
    };

    expect(fromRow(REPO_COLUMNS, row)).toEqual({
      id: "abc",
      fullName: "re-cinq/lore",
      lastIngestedAt: null,
    });
  });
});

describe("pickColumns", () => {
  it("keeps only the named fields, in the order named", () => {
    expect(pickColumns(REPO_COLUMNS, ["fullName", "id"])).toEqual({
      fullName: "full_name",
      id: "id",
    });
  });

  it("narrows a SELECT list to a projection of the model", () => {
    expect(
      selectList(pickColumns(REPO_COLUMNS, ["id", "lastIngestedAt"])),
    ).toBe("id, last_ingested_at");
  });
});

describe("toRow", () => {
  it("keys the model's fields by the columns that store them", () => {
    const repo = {
      id: "abc",
      fullName: "re-cinq/lore",
      lastIngestedAt: null,
    };

    expect(toRow(REPO_COLUMNS, repo)).toEqual({
      id: "abc",
      full_name: "re-cinq/lore",
      last_ingested_at: null,
    });
  });

  it("round-trips a row through fromRow and back unchanged", () => {
    const row = {
      id: "abc",
      full_name: "re-cinq/lore",
      last_ingested_at: null,
    };

    expect(toRow(REPO_COLUMNS, fromRow<Repo>(REPO_COLUMNS, row))).toEqual(row);
  });
});

/**
 * Both halves are TYPE assertions, and they do not fail the same way. The
 * positive case fails at the alias — `Assert<false>` is a type error, so `tsc`
 * rejects the file whether or not the test runs. The negative case is an
 * assignment, and vitest alone is happy with either value: only `tsc --noEmit`
 * reads it. That holds as long as test files stay inside the typecheck project,
 * which is what makes this pair a guard rather than a pair of true statements.
 */
describe("KeysAreColumns", () => {
  it("holds for a shape whose every key is a column", () => {
    type Wire = { id: string; full_name: string };
    type Check = Assert<KeysAreColumns<Wire, Repo, typeof REPO_COLUMNS>>;
    const holds: Check = true;

    expect(holds).toBe(true);
  });

  it("resolves false for a shape carrying a key no column binds", () => {
    type Wire = { id: string; cost_usd: number };
    const holds: KeysAreColumns<Wire, Repo, typeof REPO_COLUMNS> = false;

    expect(holds).toBe(false);
  });
});
