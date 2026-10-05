import type { StationInput } from "@re-cinq/lore-shared/station-input.js";

export interface TriageLabelDeps {
  project: {
    issues: {
      addLabel(number: number, label: string): Promise<void>;
    };
  };
}

export interface TriageLabelResult {
  outcome: "success" | "failed";
}

export function triageLabelForOutcome(outcome: string): string {
  return `triage: ${outcome}`;
}

export async function runTriageLabelStation(
  input: StationInput,
  deps: TriageLabelDeps,
): Promise<TriageLabelResult> {
  const { outcome, issue_number } = input.params;
  const label = triageLabelForOutcome(outcome);
  const issueNumber = Number(issue_number);

  try {
    await deps.project.issues.addLabel(issueNumber, label);
    return { outcome: "success" };
  } catch {
    return { outcome: "failed" };
  }
}
