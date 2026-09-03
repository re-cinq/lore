import { describe, it, expect } from "vitest";
import { z } from "zod";
import { wireSchema } from "./wire-schema.js";
import type { ColumnMap } from "./row.js";

const JobRunSchema = z.object({
  id: z.string(),
  jobName: z.string(),
  startedAt: z.date(),
  error: z.string().nullable(),
});

type JobRun = z.infer<typeof JobRunSchema>;

const JOB_RUN_COLUMNS = {
  id: "id",
  jobName: "job_name",
  startedAt: "started_at",
  error: "error",
} as const satisfies ColumnMap<JobRun>;

describe("wireSchema", () => {
  it("renames every field to the column that stores it", () => {
    const wire = wireSchema(JobRunSchema, JOB_RUN_COLUMNS);

    expect(Object.keys(wire.shape)).toEqual([
      "id",
      "job_name",
      "started_at",
      "error",
    ]);
  });

  it("parses a row keyed by column names", () => {
    const wire = wireSchema(JobRunSchema, JOB_RUN_COLUMNS);

    expect(
      wire.parse({
        id: "r1",
        job_name: "reindex",
        started_at: new Date("2026-08-20T00:00:00Z"),
        error: null,
      }),
    ).toEqual({
      id: "r1",
      job_name: "reindex",
      started_at: new Date("2026-08-20T00:00:00Z"),
      error: null,
    });
  });

  it("rejects a row still keyed by the model's field names", () => {
    const wire = wireSchema(JobRunSchema, JOB_RUN_COLUMNS);

    expect(
      wire.safeParse({
        id: "r1",
        jobName: "reindex",
        startedAt: new Date(),
        error: null,
      }).success,
    ).toBe(false);
  });

  it("keeps each field's own schema, so a subset can be projected", () => {
    const wire = wireSchema(
      JobRunSchema.pick({ id: true, jobName: true }),
      JOB_RUN_COLUMNS,
    );

    expect(Object.keys(wire.shape)).toEqual(["id", "job_name"]);
  });
});

describe("an unbound field", () => {
  it("refuses to rename a field the column map does not bind (reachable via a runtime-built schema or `as`-widened map)", () => {
    const withExtra = JobRunSchema.extend({ unbound: z.string() });

    expect(() =>
      wireSchema(withExtra, JOB_RUN_COLUMNS as ColumnMap<never>),
    ).toThrow(new Error('wireSchema: no column bound for field "unbound"'));
  });
});
