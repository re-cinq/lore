import { describe, it, expect } from "vitest";
import { readCiJobLog } from "./ci-job-log.js";

const log = [
  "2026-09-09T13:06:58.1Z ##[endgroup]",
  "2026-09-09T13:06:58.3Z specs/x/spec.md",
  "2026-09-09T13:06:58.4Z ##[error]  7:1  error  Status draft",
  "2026-09-09T13:06:58.6Z ##[error]Process completed with exit code 1.",
].join("\n");

describe("readCiJobLog", () => {
  it("returns the job's last lines, the count the filter kept, and whether the tail cut any", async () => {
    expect(
      await readCiJobLog({ jobLog: async () => log }, 7, {
        tail: 2,
        grep: "error",
      }),
    ).toEqual({
      job_id: 7,
      lines: [
        "##[error]  7:1  error  Status draft",
        "##[error]Process completed with exit code 1.",
      ],
      total: 2,
      truncated: false,
    });
  });

  it("returns null when GitHub will not show the job's log", async () => {
    expect(
      await readCiJobLog({ jobLog: async () => null }, 7, { tail: 200 }),
    ).toBe(null);
  });
});
