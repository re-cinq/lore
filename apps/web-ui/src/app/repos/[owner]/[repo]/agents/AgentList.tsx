import Link from "next/link";
import type { CSSProperties } from "react";
import type { AgentDefinition } from "@/lib/agents-mirror";
import type {
  AgentApplyStatus,
  AgentUsage,
  AgentUsageRef,
} from "@/lib/agents-api";
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
  refs: Record<string, AgentUsageRef[]> | null,
): { text: string; dormant: boolean } {
  // Unknown is not "unreferenced": with no usage data (endpoint unreachable,
  // older lore-api) claiming "no assembly line" would be a wrong statement
  // dressed as a fact — a stale server 404'd exactly this way once.
  if (refs === null) {
    return { text: "—", dormant: false };
  }
  const own = refs[def.name];

  if (!(own && own.length > 0)) {
    if (def.execution_mode === "station") {
      return { text: "not referenced by any assembly line", dormant: true };
    }

    return {
      text: "no assembly line — runs as a single agent",
      dormant: false,
    };
  }

  // Grouped per line, each line named once: a station visited by five nodes
  // of one blueprint reads "general · a, b, c, d, e", not five repetitions
  // of the blueprint name. Duplicate (line, node) pairs collapse too.
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

/**
 * The Mode cell: "claude-code" says nothing a reader can act on, so an LLM
 * recipe shows the assembly line(s) that dispatch it instead — deduped, since
 * a line can visit one station from several nodes. Station and zero-LLM modes
 * keep their tags (a station can serve many lines and its mode is the fact
 * that matters); a blueprint-less LLM recipe reads "single agent", and with no
 * usage data at all the raw mode is the only honest answer left.
 */
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

/**
 * What the clusters did with this definition. The distinction that matters is
 * refused-vs-unknown: no verdict means nobody has reported yet, which is NOT a
 * claim that every cluster applied it — the whole reason this column exists is
 * that a refusal used to live only in one pod's stdout.
 */
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

/**
 * Read-only table of a repo's resolved agent definitions — the house `<table>`
 * (globals.css), one row per definition. A definition with no project row is
 * labelled `org` (the organisation default); once overridden it's `project`.
 * Editing/creating happens on dedicated pages (Edit / New links) so the Agents
 * tab stays selected with a breadcrumb.
 */
export default function AgentList({
  base,
  agents,
  usage = null,
  orgEditable = false,
}: {
  /** Repo base path for the Edit links — null renders the org-catalog table
   *  (the global /agents page). */
  base: string | null;
  agents: AgentDefinition[];
  /** Blueprint references and per-cluster verdicts, from the usage endpoint —
   *  null when the endpoint could not answer (renders as unknown). */
  usage?: AgentUsage | null;
  /** With base null: link each row to the global org-default editor
   *  (`/agents/edit/[name]`) instead of rendering read-only. */
  orgEditable?: boolean;
}) {
  const showEdit = base !== null || orgEditable;
  const editHref = (name: string) =>
    base !== null
      ? `${base}/agents/${encodeURIComponent(name)}/edit`
      : `/agents/edit/${encodeURIComponent(name)}`;

  return (
    <div>
      {base !== null ? (
        <p className={styles.hint}>
          Per-repo agent definitions. An <strong>org</strong> definition is the
          organisation default; editing one creates a <strong>project</strong>{" "}
          definition for this repo, and later edits update that project
          definition.
        </p>
      ) : orgEditable ? (
        <p className={styles.hint}>
          The org-default catalog every repo inherits. Editing here updates the
          organisation default for every repo without its own override; a
          repo&apos;s Agents tab still overrides per repo.
        </p>
      ) : (
        <p className={styles.hint}>
          The org-default catalog every repo inherits. Editing is a per-repo act
          — open a repo&apos;s Agents tab to override a definition there.
        </p>
      )}

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
