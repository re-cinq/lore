import { describe, it, expect } from "vitest";
import { selectList, fromRow, pickColumns, type ColumnMap } from "./row.js";

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
