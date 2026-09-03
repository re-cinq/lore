import CollapsibleCard from "@/components/CollapsibleCard";
import Linkified from "@/components/Linkified";
import { TimeAgo } from "@/components/TimeAgo";
import type { TaskRuntimeLlmCall } from "@/lib/task-runtime";
import styles from "./TaskDetailView.module.css";

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
              <tr key={`${c.created_at}-${i}`}>
                <td className={styles.mono}>{c.model}</td>
                <td>
                  {c.status === "failed" ? (
                    <span
                      className="badge badge-red"
                      title={c.error ?? undefined}
                    >
                      failed
                    </span>
                  ) : (
                    <span className="op-badge op-pr-created">success</span>
                  )}
                  {c.status === "failed" && c.error && (
                    <div className={`meta ${styles.callError}`}>
                      <Linkified text={c.error} repo={repo} />
                    </div>
                  )}
                </td>
                <td className={styles.mono}>
                  {Number(c.input_tokens).toLocaleString()} /{" "}
                  {Number(c.output_tokens).toLocaleString()}
                </td>
                <td className={styles.mono}>
                  {c.duration_ms
                    ? `${(Number(c.duration_ms) / 1000).toFixed(1)}s`
                    : "—"}
                </td>
                <td className="meta">
                  {/* created_at permits null but every row from runner carries one */}
                  {c.created_at ? <TimeAgo date={c.created_at} /> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </CollapsibleCard>
  );
}
