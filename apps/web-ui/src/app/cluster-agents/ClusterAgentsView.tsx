import { Alert } from "@/components/Alert";
import Link from "next/link";
import { TimeAgo } from "@/components/TimeAgo";
import { EmptyState } from "@/components/EmptyState";
import type {
  ClusterAgentRow,
  ClusterInstallInfo,
  ClusterOfflineEvent,
} from "@/lib/api/cluster-agents";
import ConnectClusterPanel from "./ConnectClusterPanel";
import PauseClusterButton from "./PauseClusterButton";
import RestartClusterButton from "./RestartClusterButton";
import DataTable from "@/components/DataTable";

/** Central cluster: lore-api dials static in-cluster address; satellites have no inbound path. */
const CENTRAL_CLUSTER_AGENT_NAME = "central";

export interface ClusterAgentsViewProps {
  agents: ClusterAgentRow[];
  offlineEvents: ClusterOfflineEvent[];
  /** Null when the install hand-out could not be fetched (the panel hides). */
  installInfo: ClusterInstallInfo | null;
  /** Takes cluster in/out of rotation; container binds agent id. */
  togglePaused: (id: string, paused: boolean) => Promise<void>;
  /** Bounces the central cluster-agent. The container binds the agent id. */
  restart: (id: string) => Promise<void>;
}

/** "12m 30s" from milliseconds; a claim age is minutes, not dates. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

type ClusterAgent = ClusterAgentsViewProps["agents"][number];

/** How many station runs this cluster is holding, linked to them when there are any. A zero is left as plain text: a link to an empty list is a dead end. */
function RunningClaims({ agent }: { agent: ClusterAgent }) {
  if (agent.running_claims === 0) {
    return <>{agent.running_claims}</>;
  }

  return (
    <Link href={`/assembly-runs?cluster_agent_id=${agent.id}`}>
      {agent.running_claims}
    </Link>
  );
}

/** Pause, and — for the platform's own cluster only — restart. A satellite is someone else's cluster to bounce. Both actions are BOUND via `.bind()`: an inline arrow would not serialize to a client component. */
function ClusterActions({
  agent,
  togglePaused,
  restart,
}: Pick<ClusterAgentsViewProps, "togglePaused" | "restart"> & {
  agent: ClusterAgent;
}) {
  return (
    <span>
      <PauseClusterButton
        paused={agent.paused}
        toggle={togglePaused.bind(null, agent.id)}
      />
      {agent.name === CENTRAL_CLUSTER_AGENT_NAME && (
        <RestartClusterButton restart={restart.bind(null, agent.id)} />
      )}
    </span>
  );
}

/** One cluster as a row of cells, in the roster's column order. */
function rosterCells(
  agent: ClusterAgent,
  togglePaused: ClusterAgentsViewProps["togglePaused"],
  restart: ClusterAgentsViewProps["restart"],
) {
  return [
    agent.name,
    <ClusterTags tags={agent.tags} key="tags" />,
    <ClusterStatus status={agent.status} paused={agent.paused} key="status" />,
    <TimeAgo date={agent.last_seen_at} key="seen" />,
    <RunningClaims agent={agent} key="claims" />,
    <ClusterActions
      agent={agent}
      togglePaused={togglePaused}
      restart={restart}
      key="actions"
    />,
  ];
}

type ClusterRosterProps = Pick<
  ClusterAgentsViewProps,
  "agents" | "togglePaused" | "restart"
>;

/** What each registered cluster can run and whether it is alive. Restart is offered only for the platform's own cluster — a satellite is not ours to bounce. */
function ClusterRoster({ agents, togglePaused, restart }: ClusterRosterProps) {
  if (agents.length === 0) {
    return (
      <EmptyState
        title="No clusters registered"
        description="A cluster-agent joins this roster when it registers against the Lore API."
      />
    );
  }

  return (
    <DataTable
      columns={["Name", "Tags", "Status", "Last seen", "Running claims", ""]}
      rows={agents}
      rowKey={(agent) => agent.id}
      cells={(agent) => rosterCells(agent, togglePaused, restart)}
    />
  );
}

/** The cluster's name, falling back to its raw id (FR7). A cluster that has since been deleted still has events on record, and its id is more use to the reader than an em dash. */
function clusterLabel(
  clusterAgentId: string | null,
  nameById: Map<string, string>,
): string {
  if (!clusterAgentId) {
    return "—";
  }

  return nameById.get(clusterAgentId) ?? clusterAgentId;
}

/** The run this event requeued, when it names one. Shown by its first eight characters — enough to recognise, short enough for a table. */
function RunLink({ runId }: { runId: string | null }) {
  if (!runId) {
    return <>—</>;
  }

  return <Link href={`/assembly-runs/${runId}`}>{runId.slice(0, 8)}</Link>;
}

interface OfflineEventsTableProps {
  events: ClusterAgentsViewProps["offlineEvents"];
  nameById: Map<string, string>;
}

/** A row appears when the reaper marks a cluster offline and requeues a station run it held, so a flapping cluster is visible as repetition here. */
function OfflineEventsTable({ events, nameById }: OfflineEventsTableProps) {
  return events.length === 0 ? (
    <Alert variant="secondary">No offline events recorded.</Alert>
  ) : (
    <DataTable
      columns={["Time", "Cluster", "Node", "Assembly run", "Held for"]}
      rows={events}
      rowKey={(event, index) =>
        `${event.created_at}-${event.station_run_id ?? index}`
      }
      cells={(event) => offlineEventCells(event, nameById)}
    />
  );
}

/** One offline event as a row of cells, in the table's column order. */
function offlineEventCells(
  event: ClusterOfflineEvent,
  nameById: Map<string, string>,
) {
  return [
    <TimeAgo date={event.created_at} key="time" />,
    clusterLabel(event.cluster_agent_id, nameById),
    event.node_id ?? "—",
    <RunLink runId={event.assembly_run_id} key="run" />,
    event.elapsed_since_claim_ms === null
      ? "—"
      : formatElapsed(event.elapsed_since_claim_ms),
  ];
}

/** Clusters view: pure render with offline audit fallback to raw id (FR7). */
export default function ClusterAgentsView(props: ClusterAgentsViewProps) {
  const { agents, offlineEvents, installInfo, togglePaused, restart } = props;
  const nameById = new Map(agents.map((agent) => [agent.id, agent.name]));

  return (
    <div>
      <ClustersHeading />
      {installInfo && <ConnectClusterPanel install={installInfo} />}
      <ClusterRoster
        agents={agents}
        togglePaused={togglePaused}
        restart={restart}
      />
      <OfflineEventsSection events={offlineEvents} nameById={nameById} />
    </div>
  );
}

function ClustersHeading() {
  return (
    <>
      <h1>Clusters</h1>
      <p className="meta page-lede">
        Every registered execution cluster: what it can run, whether it is
        alive, and how many station runs it currently holds.
      </p>
    </>
  );
}

function OfflineEventsSection({ events, nameById }: OfflineEventsTableProps) {
  return (
    <>
      <h2>Recent offline events</h2>
      <p className="meta">
        A row appears when the reaper marks a cluster offline and requeues a
        station run it held — a flapping cluster shows up here.
      </p>
      <OfflineEventsTable events={events} nameById={nameById} />
    </>
  );
}

function ClusterTags({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return <>—</>;
  }

  return (
    <>
      {tags.map((tag) => (
        <span key={tag} className="badge badge-gray">
          {tag}
        </span>
      ))}
    </>
  );
}

/** Liveness and paused are independent, so both badges can show at once. */
function ClusterStatus({
  status,
  paused,
}: {
  status: string;
  paused: boolean;
}) {
  return (
    <>
      <span
        className={`badge ${status === "offline" ? "badge-red" : "badge-green"}`}
      >
        {status}
      </span>
      {paused && <span className="badge badge-gray">paused</span>}
    </>
  );
}
