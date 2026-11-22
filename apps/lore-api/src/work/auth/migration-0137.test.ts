import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../../deploy/chart/charts/ui-helm/migrations/0137_api_tokens_github_id.sql",
  ),
  "utf-8",
);

describe("migration 0137, the GitHub numeric id on pipeline.api_tokens", () => {
  it("adds a bigint github_id column and an index on it", () => {
    expect({
      column: /ADD COLUMN IF NOT EXISTS github_id BIGINT/.test(sql),
      index:
        /CREATE INDEX IF NOT EXISTS \w+\s+ON pipeline\.api_tokens \(github_id\)/.test(
          sql,
        ),
    }).toEqual({ column: true, index: true });
  });
});
