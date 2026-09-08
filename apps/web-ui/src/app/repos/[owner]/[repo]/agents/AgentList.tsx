import type { CSSProperties } from "react";
import type { AgentDefinition } from "@/lib/agents-mirror";
import type {
  AgentApplyStatus,
  AgentUsage,
  AgentUsageRef,
} from "@/lib/agents-api";
import ActionsCell, { type RemoveOverride } from "./ActionsCell";
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
  remove,
}: AgentListProps) {
  return (
    <div>
      <ScopeHint base={base} orgEditable={orgEditable} />
      {agents.length === 0 ? (
        <div className={`empty-state ${styles.emptyLeft}`}>
          <p>No agent definitions resolved for this repo.</p>
        </div>
      ) : (
        <AgentTable
          base={base}
          agents={agents}
          usage={usage}
          showEdit={base !== null || orgEditable}
          remove={base === null ? undefined : remove}
        />
      )}
    </div>
  );
}

interface AgentListProps {
  /** Repo base path for Edit links; null renders org-catalog (/agents). */
  base: string | null;
  agents: AgentDefinition[];
  /** Blueprint refs and cluster verdicts; null when endpoint unreachable (renders unknown). */
  usage?: AgentUsage | null;
  /** With base null: link to global org editor (/agents/edit/[name]). */
  orgEditable?: boolean;
  /** Drops a repo override so the org default resolves again; omitted where there is no repo to remove one from. */
  remove?: RemoveOverride;
}

function TableHead({ showEdit }: { showEdit: boolean }) {
  return (
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
  );
}

/** One row per resolved definition. The trailing edit column exists only where editing is possible, rather than rendering a disabled control — a column of dead links says less than no column. */
function AgentTable({
  base,
  agents,
  usage,
  showEdit,
  remove,
}: Pick<AgentListProps, "base" | "agents" | "usage" | "remove"> & {
  showEdit: boolean;
}) {
  return (
    <div className={styles.tableWrap}>
      <table>
        <TableHead showEdit={showEdit} />
        <tbody>
          {agents.map((agent) => (
            <AgentRow
              key={agent.name}
              agent={agent}
              usage={usage ?? null}
              editHref={showEdit ? editHref(base, agent.name) : null}
              remove={remove}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** On a repo's own tab: an edit here forks the org default into a project definition, and later edits update that fork rather than the org's copy. */
function RepoScopeHint() {
  return (
    <p className={styles.hint}>
      Per-repo agent definitions. An <strong>org</strong> definition is the
      organisation default; editing one creates a <strong>project</strong>{" "}
      definition for this repo, and later edits update that project definition.
      Removing a <strong>project</strong> definition restores the org default.
    </p>
  );
}

/** In the org catalog with edit rights: a save here moves every repo that has not overridden the definition, which is worth saying before someone saves. */
function OrgEditableHint() {
  return (
    <p className={styles.hint}>
      The org-default catalog every repo inherits. Editing here updates the
      organisation default for every repo without its own override; a
      repo&apos;s Agents tab still overrides per repo.
    </p>
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
    return <RepoScopeHint />;
  }

  if (orgEditable) {
    return <OrgEditableHint />;
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

function usageClass(dormant: boolean): string {
  return `${styles.detail} ${dormant ? styles.detailDormant : ""}`;
}

function rolloutClass(bad: boolean): string {
  return `${styles.detail} ${bad ? styles.detailBad : ""}`;
}

/** A usage or rollout cell. Both carry a flag saying the value is BAD news — dormant, or a rollout that did not land — which the class turns into something a reader scans for rather than reads. */
function StatusCell({
  kind,
  name,
  cell,
}: {
  kind: "usage" | "rollout";
  name: string;
  cell: { text: string; dormant?: boolean; bad?: boolean };
}) {
  const className =
    kind === "usage"
      ? usageClass(cell.dormant ?? false)
      : rolloutClass(cell.bad ?? false);

  return (
    <td className={className} data-testid={`${kind}-${name}`}>
      {cell.text}
    </td>
  );
}

/** The three cells derived from usage. A null `usage` means the endpoint was unreachable, NOT that the definition is unused — each helper renders that as unknown rather than as a claim nothing references it. */
function rowCells(agent: AgentDefinition, usage: AgentUsage | null) {
  const refs = usage === null ? null : usage.refs;

  return {
    use: usageLine(agent, refs),
    mode: modeLabel(agent, refs),
    rollout: rolloutCell(agent, usage === null ? null : usage.applied),
  };
}

interface AgentRowProps {
  agent: AgentDefinition;
  usage: AgentUsage | null;
  editHref: string | null;
  remove?: RemoveOverride;
}

function AgentRow({ agent, usage, editHref, remove }: AgentRowProps) {
  const { use, mode, rollout } = rowCells(agent, usage);
  const isProject = agent.project_id != null && agent.project_id !== "";

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
      <StatusCell kind="usage" name={agent.name} cell={use} />
      <StatusCell kind="rollout" name={agent.name} cell={rollout} />
      <ActionsCell
        href={editHref}
        name={agent.name}
        isProject={isProject}
        remove={remove}
      />
    </tr>
  );
}
