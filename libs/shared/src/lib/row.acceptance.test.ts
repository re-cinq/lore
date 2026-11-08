import { describe, it, expect } from "vitest";
import { toRow, type ColumnMap } from "./row.js";

interface Repo {
  id: string;
  fullName: string;
}

const REPO_COLUMNS = {
  id: "id",
  fullName: "full_name",
} as const satisfies ColumnMap<Repo>;

describe("toRow", () => {
  it("raises for a field the map does not bind", () => {
    const record = {
      id: "abc",
      fullName: "lore",
      unboundField: 42,
    };

    expect(() => toRow(REPO_COLUMNS, record as unknown as Repo)).toThrowError(
      /no column bound/,
    );
  });
});
