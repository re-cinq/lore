// What the Definition of Done card says at a glance (specs/implementation-loop FR16): the pass count as the card's status, and where that count came from.

import type { AcceptanceTestStatus, DodProgress } from "./api/dod";

export type { AcceptanceTestStatus, DodProgress };

/** The tones the card's status pill can take — a subset of the pill's own. */
export type DodTone = "ok" | "err" | "running";

export interface DodSummary {
  label: string;
  tone: DodTone;
  /** Which CI report the pass/fail came from, or that none has arrived yet. */
  hint: string;
}

const GLYPH: Record<AcceptanceTestStatus["status"], string> = {
  pass: "✓",
  fail: "✗",
  unknown: "·",
};

export function statusGlyph(status: AcceptanceTestStatus["status"]): string {
  return GLYPH[status];
}

function toneFor(passed: number, total: number, failed: number): DodTone {
  if (failed > 0) {
    return "err";
  }

  return total > 0 && passed === total ? "ok" : "running";
}

/** `2 of 5 acceptance tests pass` — red once anything fails, green once everything does, otherwise in progress. */
export function dodSummary(progress: DodProgress): DodSummary {
  const tests = progress.acceptanceTests ?? [];
  const passed = progress.passed ?? 0;
  const total = progress.total ?? tests.length;
  const failed = tests.filter((test) => test.status === "fail").length;
  const { report } = progress;

  return {
    label: `${passed} of ${total} acceptance tests pass`,
    tone: toneFor(passed, total, failed),
    hint: report
      ? `as reported by CI @ ${report.commit.slice(0, 7)}`
      : "no CI report for this branch yet",
  };
}
