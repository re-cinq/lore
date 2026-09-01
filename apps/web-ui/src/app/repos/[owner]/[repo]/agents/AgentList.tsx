import Link from "next/link";
import type { CSSProperties } from "react";
import type { AgentDefinition } from "@/lib/agents-mirror";
import type { AgentUsageRef } from "@/lib/agents-api";
import styles from "./agents.module.css";

/**
 * Where a definition is dispatched from, as one line under its card. The three
 * shapes are deliberately distinct: blueprint references name the nodes, a
 * blueprint-less LLM/ingest recipe still runs (as a single Agent CR whose
 * stationRef is the task type), and only a station-mode recipe nothing
 * references is genuinely dormant.
 */
function usageLine(
  def: AgentDefinition,
  refs: AgentUsageRef[] | undefined,
): { text: string; dormant: boolean } {
  if (refs && refs.length > 0) {
    const nodes = refs
      .map(
        (ref) =>
          `${ref.blueprint} · ${ref.node_id}${ref.inherited ? "" : " (station_ref)"}`,
      )
      .join(", ");

    return { text: `used by ${nodes}`, dormant: false };
  }

  if (def.execution_mode === "station") {
    return { text: "not referenced by any assembly line", dormant: true };
  }

  return { text: "no assembly line — runs as a single agent", dormant: false };
}

/**
 * Read-only list of a repo's resolved agent definitions. A definition with no
 * project row is labelled `org` (the organisation default); once overridden it's
 * `project`. Editing/creating happens on dedicated pages (Edit / New links) so
 * the Agents tab stays selected with a breadcrumb.
 */
export default function AgentList({
  base,
  agents,
  usage = {},
}: {
  base: string;
  agents: AgentDefinition[];
  /** Blueprint references per definition name, from the usage endpoint. */
  usage?: Record<string, AgentUsageRef[]>;
}) {
  return (
    <div>
      <p className={styles.hint}>
        Per-repo agent definitions. An <strong>org</strong> definition is the
        organisation default; editing one creates a <strong>project</strong>{" "}
        definition for this repo, and later edits update that project
        definition.
      </p>

      {agents.length === 0 ? (
        <div className={`empty-state ${styles.emptyLeft}`}>
          <p>No agent definitions resolved for this repo.</p>
        </div>
      ) : (
        <div className={styles.list}>
          {agents.map((a) => {
            const isProject = a.project_id != null && a.project_id !== "";
            const use = usageLine(a, usage[a.name]);

            return (
              <div key={a.name} className={styles.card}>
                <span className={styles.name}>{a.name}</span>
                <span
                  className="status-pill"
                  style={
                    {
                      "--pill-color": isProject
                        ? "var(--accent)"
                        : "var(--text-muted)",
                    } as CSSProperties
                  }
                >
                  {isProject ? "project" : "org"}
                </span>
                <span className={styles.detail}>
                  {a.model ?? "(inherit)"} · {a.timeout_minutes ?? "–"}m
                  {a.execution_mode === "graph-ingest" ? " · zero-LLM" : ""}
                </span>
                <span
                  className={styles.detail}
                  style={
                    use.dormant
                      ? ({ color: "var(--warning)" } as CSSProperties)
                      : undefined
                  }
                  data-testid={`usage-${a.name}`}
                >
                  {use.text}
                </span>
                <Link
                  className={`btn-secondary ${styles.spacer}`}
                  href={`${base}/agents/${encodeURIComponent(a.name)}/edit`}
                >
                  Edit
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
