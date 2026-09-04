import CollapsibleCard from "@/components/CollapsibleCard";
import Linkified from "@/components/Linkified";
import { TimeAgo } from "@/components/TimeAgo";
import type { TaskRuntimeLlmCall } from "@/lib/task-runtime";
import styles from "./TaskDetailView.module.css";

function CallStatusCell({
  call,
  repo,
}: {
  call: TaskRuntimeLlmCall;
  repo: string;
}) {
  if (call.status !== "failed") {
    return <span className="op-badge op-pr-created">success</span>;
  }

  return (
    <>
      <span className="badge badge-red" title={call.error ?? undefined}>
        failed
      </span>
      {call.error && (
        <div className={`meta ${styles.callError}`}>
          <Linkified text={call.error} repo={repo} />
        </div>
      )}
    </>
  );
}

function formatCallDuration(
  durationMs: TaskRuntimeLlmCall["duration_ms"],
): string {
  return durationMs ? `${(Number(durationMs) / 1000).toFixed(1)}s` : "—";
}

function LlmCallRow({
  call,
  repo,
}: {
  call: TaskRuntimeLlmCall;
  repo: string;
}) {
  return (
    <tr>
      <td className={styles.mono}>{call.model}</td>
      <td>
        <CallStatusCell call={call} repo={repo} />
      </td>
      <td className={styles.mono}>
        {Number(call.input_tokens).toLocaleString()} /{" "}
        {Number(call.output_tokens).toLocaleString()}
      </td>
      <td className={styles.mono}>{formatCallDuration(call.duration_ms)}</td>
      <td className="meta">
        {/* created_at permits null but every row from runner carries one */}
        {call.created_at ? <TimeAgo date={call.created_at} /> : "—"}
      </td>
    </tr>
  );
}

/** Per-run LLM cost/token rows (pipeline.llm_calls). Pure render. */
export default function LlmCallsTable({
  llmCalls,
  repo,
}: {
  llmCalls: TaskRuntimeLlmCall[];
  repo: string;
}) {
  return (
    <CollapsibleCard
      title="LLM Calls"
      defaultOpen
      emptyState="No LLM calls recorded for this task."
    >
      {llmCalls.length === 0 ? null : (
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th>Status</th>
              <th>Tokens (in/out)</th>
              <th>Duration</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {llmCalls.map((c, i) => (
              <LlmCallRow key={`${c.created_at}-${i}`} call={c} repo={repo} />
            ))}
          </tbody>
        </table>
      )}
    </CollapsibleCard>
  );
}
