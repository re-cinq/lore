import type { CSSProperties } from "react";
import type { AgentDefinition } from "@/lib/agents-mirror";
import type { AgentUsage } from "@/lib/agents-api";
import ActionsCell, { type RemoveOverride } from "./ActionsCell";
import { rowCells } from "./agent-row-cells";
import styles from "./agents.module.css";

/** Nothing resolved for this repo — neither an org default nor an override, which is a configuration state rather than an error. */
function EmptyDefinitions() {
  return (
    <div className={`empty-state ${styles.emptyLeft}`}>
      <p>No agent definitions resolved for this repo.</p>
    </div>
  );
}

/** Agent definitions table; org vs project labeling (editing on dedicated pages). */
export default function AgentList(props: AgentListProps) {
  const { base, agents, usage = null, orgEditable = false, remove } = props;

  return (
    <div>
      <ScopeHint base={base} orgEditable={orgEditable} />
      {agents.length === 0 ? (
        <EmptyDefinitions />
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

interface AgentTableProps extends Pick<
  AgentListProps,
  "base" | "agents" | "usage" | "remove"
> {
  showEdit: boolean;
}

/** One row per resolved definition, in the order the caller resolved them. */
function AgentRows({ base, agents, usage, showEdit, remove }: AgentTableProps) {
  return (
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
  );
}

/** The trailing edit column exists only where editing is possible, rather than rendering a disabled control — a column of dead links says less than no column. */
function AgentTable(props: AgentTableProps) {
  return (
    <div className={styles.tableWrap}>
      <table>
        <TableHead showEdit={props.showEdit} />
        <AgentRows {...props} />
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

interface AgentRowProps {
  agent: AgentDefinition;
  usage: AgentUsage | null;
  editHref: string | null;
  remove?: RemoveOverride;
}

interface AgentConfigCellsProps {
  agent: AgentDefinition;
  mode: string;
  isProject: boolean;
}

/** What the definition is configured AS: its scope, model, timeout and dispatch mode. Blank fields read as "(inherit)" rather than as nothing chosen. */
function AgentConfigCells({ agent, mode, isProject }: AgentConfigCellsProps) {
  return (
    <>
      <td>
        <ScopePill isProject={isProject} />
      </td>
      <td className={styles.detail}>{agent.model ?? "(inherit)"}</td>
      <td className={styles.detail}>{agent.timeout_minutes ?? "–"}m</td>
      <td className={styles.detail} data-testid={`mode-${agent.name}`}>
        {mode}
      </td>
    </>
  );
}

function AgentRow({ agent, usage, editHref, remove }: AgentRowProps) {
  const { use, mode, rollout } = rowCells(agent, usage);
  const isProject = agent.project_id != null && agent.project_id !== "";

  return (
    <tr>
      <td className={styles.name}>{agent.name}</td>
      <AgentConfigCells agent={agent} mode={mode} isProject={isProject} />
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
