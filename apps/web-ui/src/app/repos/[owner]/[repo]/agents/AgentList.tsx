import Link from "next/link";
import type { CSSProperties } from "react";
import type { AgentDefinition } from "@/lib/agents-mirror";
import type {
  AgentApplyStatus,
  AgentUsage,
  AgentUsageRef,
} from "@/lib/agents-api";
import styles from "./agents.module.css";

// Group per blueprint; dedupe (line, node) pairs; collapse duplicate refs.
function groupRefsByLine(refs: AgentUsageRef[]): string {
  const byLine = new Map<string, string[]>();

  for (const ref of refs) {
    const node = `${ref.node_id}${ref.inherited ? "" : " (station_ref)"}`;
    const nodes = byLine.get(ref.blueprint) ?? [];

    if (!nodes.includes(node)) {
      nodes.push(node);
    }
    byLine.set(ref.blueprint, nodes);
  }

  return [...byLine]
    .map(([blueprint, nodes]) => `${blueprint} · ${nodes.join(", ")}`)
    .join("; ");
}

/** Where definition is dispatched from; three shapes: blueprint refs, single-agent, dormant-station. */
function usageLine(
  def: AgentDefinition,
  refs: Record<string, AgentUsageRef[] | undefined> | null,
): { text: string; dormant: boolean } {
  // Unknown ≠ unreferenced: null usage means endpoint unreachable or old lore-api.
  if (refs === null) {
    return { text: "—", dormant: false };
  }
  const own = refs[def.name];
  const unreferenced = !own || own.length === 0;

  if (unreferenced) {
    return def.execution_mode === "station"
      ? { text: "not referenced by any assembly line", dormant: true }
      : { text: "no assembly line — runs as a single agent", dormant: false };
  }

  return { text: `used by ${groupRefsByLine(own)}`, dormant: false };
}

function dispatchLines(refs: AgentUsageRef[]): string {
  return [...new Set(refs.map((ref) => ref.blueprint))].join(", ");
}

function ownRefs(
  def: AgentDefinition,
  refs: Record<string, AgentUsageRef[] | undefined> | null,
): AgentUsageRef[] | null {
  return refs ? (refs[def.name] ?? null) : null;
}

/** Mode cell: LLM recipes show dispatch lines (deduped), station/zero-LLM keep tags, single-agent fallback. */
function modeLabel(
  def: AgentDefinition,
  refs: Record<string, AgentUsageRef[] | undefined> | null,
): string {
  if (def.execution_mode === "station") {
    return "station";
  }

  if (def.execution_mode === "graph-ingest") {
    return "zero-LLM";
  }
  const own = ownRefs(def, refs);

  if (own && own.length > 0) {
    return dispatchLines(own);
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

  return (
    <div>
      <ScopeHint base={base} orgEditable={orgEditable} />
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
              {agents.map((a) => (
                <AgentRow
                  key={a.name}
                  agent={a}
                  usage={usage}
                  editHref={showEdit ? editHref(base, a.name) : null}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Editing is a per-repo act everywhere except the org catalog, so where you are decides what an edit means. */
function ScopeHint({
  base,
  orgEditable,
}: {
  base: string | null;
  orgEditable: boolean;
}) {
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
}

function editHref(base: string | null, name: string): string {
  return base !== null
    ? `${base}/agents/${encodeURIComponent(name)}/edit`
    : `/agents/edit/${encodeURIComponent(name)}`;
}

function ScopePill({ isProject }: { isProject: boolean }) {
  return (
    <span
      className="status-pill"
      style={
        {
          "--pill-color": isProject ? "var(--accent)" : "var(--text-muted)",
        } as CSSProperties
      }
    >
      {isProject ? "project" : "org"}
    </span>
  );
}

function EditCell({ href }: { href: string | null }) {
  if (!href) {
    return null;
  }

  return (
    <td>
      <Link className="btn-secondary" href={href}>
        Edit
      </Link>
    </td>
  );
}

function usageClass(dormant: boolean): string {
  return `${styles.detail} ${dormant ? styles.detailDormant : ""}`;
}

function rolloutClass(bad: boolean): string {
  return `${styles.detail} ${bad ? styles.detailBad : ""}`;
}

function AgentRow({
  agent,
  usage,
  editHref,
}: {
  agent: AgentDefinition;
  usage: AgentUsage | null;
  editHref: string | null;
}) {
  const isProject = agent.project_id != null && agent.project_id !== "";
  const refs = usage === null ? null : usage.refs;
  const applied = usage === null ? null : usage.applied;
  const use = usageLine(agent, refs);
  const mode = modeLabel(agent, refs);
  const rollout = rolloutCell(agent, applied);

  return (
    <tr>
      <td className={styles.name}>{agent.name}</td>
      <td>
        <ScopePill isProject={isProject} />
      </td>
      <td className={styles.detail}>{agent.model ?? "(inherit)"}</td>
      <td className={styles.detail}>{agent.timeout_minutes ?? "–"}m</td>
      <td className={styles.detail} data-testid={`mode-${agent.name}`}>
        {mode}
      </td>
      <td
        className={usageClass(use.dormant)}
        data-testid={`usage-${agent.name}`}
      >
        {use.text}
      </td>
      <td
        className={rolloutClass(rollout.bad)}
        data-testid={`rollout-${agent.name}`}
      >
        {rollout.text}
      </td>
      <EditCell href={editHref} />
    </tr>
  );
}
