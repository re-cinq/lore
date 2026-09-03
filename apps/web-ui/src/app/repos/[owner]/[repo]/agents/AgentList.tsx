import Link from "next/link";
import type { CSSProperties } from "react";
import type { AgentDefinition } from "@/lib/agents-mirror";
import type {
  AgentApplyStatus,
  AgentUsage,
  AgentUsageRef,
} from "@/lib/agents-api";
import styles from "./agents.module.css";

/** Where definition is dispatched from; three shapes: blueprint refs, single-agent, dormant-station. */
function usageLine(
  def: AgentDefinition,
  refs: Record<string, AgentUsageRef[]> | null,
): { text: string; dormant: boolean } {
  // Unknown ≠ unreferenced: null usage means endpoint unreachable or old lore-api.
  if (refs === null) {
    return { text: "—", dormant: false };
  }
  const own = refs[def.name];
  const unreferenced = !(own && own.length > 0);

  if (unreferenced && def.execution_mode === "station") {
    return { text: "not referenced by any assembly line", dormant: true };
  }

  if (unreferenced) {
    return {
      text: "no assembly line — runs as a single agent",
      dormant: false,
    };
  }

  // Group per blueprint; dedupe (line, node) pairs; collapse duplicate refs.
  const byLine = new Map<string, string[]>();

  for (const ref of own) {
    const node = `${ref.node_id}${ref.inherited ? "" : " (station_ref)"}`;
    const nodes = byLine.get(ref.blueprint) ?? [];

    if (!nodes.includes(node)) {
      nodes.push(node);
    }
    byLine.set(ref.blueprint, nodes);
  }
  const lines = [...byLine]
    .map(([blueprint, nodes]) => `${blueprint} · ${nodes.join(", ")}`)
    .join("; ");

  return { text: `used by ${lines}`, dormant: false };
}

/** Mode cell: LLM recipes show dispatch lines (deduped), station/zero-LLM keep tags, single-agent fallback. */
function modeLabel(
  def: AgentDefinition,
  refs: Record<string, AgentUsageRef[]> | null,
): string {
  if (def.execution_mode === "station") {
    return "station";
  }

  if (def.execution_mode === "graph-ingest") {
    return "zero-LLM";
  }
  const own = refs?.[def.name];

  if (own && own.length > 0) {
    return [...new Set(own.map((ref) => ref.blueprint))].join(", ");
  }

  return refs === null ? def.execution_mode : "single agent";
}

/** Cluster rollout verdict; no verdict ≠ applied (reason: refusals once lived in stdout). */
function rolloutCell(
  def: AgentDefinition,
  applied: Record<string, AgentApplyStatus[]> | null,
): { text: string; bad: boolean } {
  if (applied === null) {
    return { text: "—", bad: false };
  }
  const own = (applied[def.name] ?? []).filter(
    (s) => (s.project_id ?? null) === (def.project_id ?? null),
  );

  if (own.length === 0) {
    return { text: "not reported", bad: false };
  }
  const problems = own.filter(
    (s) => s.state !== "applied" && s.state !== "deleted",
  );

  if (problems.length === 0) {
    return { text: `applied · ${own.length} cluster(s)`, bad: false };
  }

  return {
    text: problems
      .map((s) => `${s.cluster}: ${s.state}${s.reason ? ` — ${s.reason}` : ""}`)
      .join("; "),
    bad: true,
  };
}

/** Agent definitions table; org vs project labeling (editing on dedicated pages). */
export default function AgentList({
  base,
  agents,
  usage = null,
  orgEditable = false,
}: {
  /** Repo base path for Edit links; null renders org-catalog (/agents). */
  base: string | null;
  agents: AgentDefinition[];
  /** Blueprint refs and cluster verdicts; null when endpoint unreachable (renders unknown). */
  usage?: AgentUsage | null;
  /** With base null: link to global org editor (/agents/edit/[name]). */
  orgEditable?: boolean;
}) {
  const showEdit = base !== null || orgEditable;
  const editHref = (name: string) =>
    base !== null
      ? `${base}/agents/${encodeURIComponent(name)}/edit`
      : `/agents/edit/${encodeURIComponent(name)}`;

  const renderHint = () => {
    if (base !== null) {
      return (
        <p className={styles.hint}>
          Per-repo agent definitions. An <strong>org</strong> definition is the
          organisation default; editing one creates a <strong>project</strong>{" "}
          definition for this repo, and later edits update that project
          definition.
        </p>
      );
    }

    if (orgEditable) {
      return (
        <p className={styles.hint}>
          The org-default catalog every repo inherits. Editing here updates the
          organisation default for every repo without its own override; a
          repo&apos;s Agents tab still overrides per repo.
        </p>
      );
    }

    return (
      <p className={styles.hint}>
        The org-default catalog every repo inherits. Editing is a per-repo act —
        open a repo&apos;s Agents tab to override a definition there.
      </p>
    );
  };

  return (
    <div>
      {renderHint()}

      {agents.length === 0 ? (
        <div className={`empty-state ${styles.emptyLeft}`}>
          <p>No agent definitions resolved for this repo.</p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Scope</th>
                <th>Model</th>
                <th>Timeout</th>
                <th>Mode</th>
                <th>Used by</th>
                <th>Rollout</th>
                {showEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => {
                const isProject = a.project_id != null && a.project_id !== "";
                const use = usageLine(a, usage?.refs ?? null);
                const rollout = rolloutCell(a, usage?.applied ?? null);

                return (
                  <tr key={a.name}>
                    <td className={styles.name}>{a.name}</td>
                    <td>
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
                    </td>
                    <td className={styles.detail}>{a.model ?? "(inherit)"}</td>
                    <td className={styles.detail}>
                      {a.timeout_minutes ?? "–"}m
                    </td>
                    <td
                      className={styles.detail}
                      data-testid={`mode-${a.name}`}
                    >
                      {modeLabel(a, usage?.refs ?? null)}
                    </td>
                    <td
                      className={styles.detail}
                      style={
                        use.dormant
                          ? ({ color: "var(--warning)" } as CSSProperties)
                          : undefined
                      }
                      data-testid={`usage-${a.name}`}
                    >
                      {use.text}
                    </td>
                    <td
                      className={styles.detail}
                      style={
                        rollout.bad
                          ? ({ color: "var(--danger)" } as CSSProperties)
                          : undefined
                      }
                      data-testid={`rollout-${a.name}`}
                    >
                      {rollout.text}
                    </td>
                    {showEdit && (
                      <td>
                        <Link className="btn-secondary" href={editHref(a.name)}>
                          Edit
                        </Link>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
