"use client";

// The model calls one attempt made (run-viz FR4.1i), from the floor's llm_call records: an agent's per model, a service station's per call. Nothing called, nothing drawn.
import CollapsibleCard from "@/components/CollapsibleCard";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import { readVisitModelCalls, type VisitModelCall } from "@/lib/visit-reads";
import { useVisitRead } from "./use-visit-read";
import styles from "./AttemptCards.module.css";

interface NodeModelCallsCardProps {
  runId: string;
  attempt: AssemblyRunNode;
}

export default function NodeModelCallsCard({
  runId,
  attempt,
}: NodeModelCallsCardProps) {
  const calls = useVisitRead(
    readVisitModelCalls,
    runId,
    attempt.stationRunId,
    attempt.outcome ?? "open",
  );

  return <ModelCallsView calls={calls} />;
}

export function ModelCallsView({
  calls,
}: {
  calls: readonly VisitModelCall[];
}) {
  if (calls.length === 0) {
    return null;
  }
  const total = calls.reduce((sum, call) => sum + (call.costUsd ?? 0), 0);

  return (
    <CollapsibleCard
      title="Model calls"
      defaultOpen
      labels={[`${calls.length}`, dollars(total)]}
    >
      <CallsTable calls={calls} />
    </CollapsibleCard>
  );
}

function CallsTable({ calls }: { calls: readonly VisitModelCall[] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Model</th>
          <th>Tokens in / out</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>{calls.map(callRow)}</tbody>
    </table>
  );
}

function callRow(call: VisitModelCall, place: number) {
  return (
    <tr key={`${call.seq}-${place}`}>
      <td className={styles.mono}>{call.model ?? "—"}</td>
      <td>{`${call.tokensIn ?? "—"} / ${call.tokensOut ?? "—"}`}</td>
      <td>{call.costUsd === null ? "—" : dollars(call.costUsd)}</td>
    </tr>
  );
}

function dollars(amount: number): string {
  return `$${amount.toFixed(4)}`;
}
