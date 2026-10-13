// A step's answer, for a station that leaves no transcript (run-viz FR4.1i): the outcome it reported and, when it failed, the error it gave, where the reader looks first.
import CollapsibleCard from "@/components/CollapsibleCard";
import type { StatusTone } from "@/components/StatusPill";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import styles from "./AttemptCards.module.css";

const SUCCESS = new Set(["success", "approved", "done"]);

export default function NodeOutcomeCard({
  attempt,
}: {
  attempt: AssemblyRunNode;
}) {
  return (
    <CollapsibleCard
      title="Outcome"
      defaultOpen
      status={outcomePill(attempt.outcome)}
    >
      {attempt.failureDetail ? (
        <p className={styles.error}>{attempt.failureDetail}</p>
      ) : null}
    </CollapsibleCard>
  );
}

export function outcomePill(outcome: string | null): {
  label: string;
  tone: StatusTone;
} {
  if (outcome === null) {
    return { label: "In progress", tone: "running" };
  }

  return { label: outcome, tone: toneOf(outcome) };
}

// A visit closed by "Run this station" (FR8) or a cancelled run ended as asked, not in error.
function toneOf(outcome: string): StatusTone {
  if (SUCCESS.has(outcome)) {
    return "ok";
  }

  return outcome === "cancelled" ? "idle" : "err";
}
