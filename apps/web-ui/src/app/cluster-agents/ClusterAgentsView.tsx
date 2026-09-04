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

/** Clusters view: pure render with offline audit fallback to raw id (FR7). */
export default function ClusterAgentsView({
  agents,
  offlineEvents,
  installInfo,
  togglePaused,
  restart,
}: ClusterAgentsViewProps) {
  const nameById = new Map(agents.map((agent) => [agent.id, agent.name]));

  return (
    <div>
      <h1>Clusters</h1>
      <p className="meta page-lede">
        Every registered execution cluster: what it can run, whether it is
        alive, and how many station runs it currently holds.
      </p>
      {installInfo && <ConnectClusterPanel install={installInfo} />}
      {agents.length === 0 ? (
        <EmptyState
          title="No clusters registered"
          description="A cluster-agent joins this roster when it registers against the Lore API."
        />
      ) : (
        <DataTable
          columns={[
            "Name",
            "Tags",
            "Status",
            "Last seen",
            "Running claims",
            "",
          ]}
          rows={agents}
          rowKey={(agent) => agent.id}
          cells={(agent) => [
            agent.name,
            <ClusterTags tags={agent.tags} key="tags" />,
            <ClusterStatus
              status={agent.status}
              paused={agent.paused}
              key="status"
            />,
            <TimeAgo date={agent.last_seen_at} key="seen" />,
            agent.running_claims > 0 ? (
              <Link
                href={`/assembly-runs?cluster_agent_id=${agent.id}`}
                key="claims"
              >
                {agent.running_claims}
              </Link>
            ) : (
              agent.running_claims
            ),
            // BOUND via .bind() — an inline arrow would not serialize to a client component.
            <span key="actions">
              <PauseClusterButton
                paused={agent.paused}
                toggle={togglePaused.bind(null, agent.id)}
              />
              {agent.name === CENTRAL_CLUSTER_AGENT_NAME && (
                <RestartClusterButton restart={restart.bind(null, agent.id)} />
              )}
            </span>,
          ]}
        />
      )}

      <h2>Recent offline events</h2>
      <p className="meta">
        A row appears when the reaper marks a cluster offline and requeues a
        station run it held — a flapping cluster shows up here.
      </p>
      {offlineEvents.length === 0 ? (
        <Alert variant="secondary">No offline events recorded.</Alert>
      ) : (
        <DataTable
          columns={["Time", "Cluster", "Node", "Assembly run", "Held for"]}
          rows={offlineEvents}
          rowKey={(event, index) =>
            `${event.created_at}-${event.station_run_id ?? index}`
          }
          cells={(event) => [
            <TimeAgo date={event.created_at} key="time" />,
            event.cluster_agent_id
              ? (nameById.get(event.cluster_agent_id) ?? event.cluster_agent_id)
              : "—",
            event.node_id ?? "—",
            event.assembly_run_id ? (
              <Link href={`/assembly-runs/${event.assembly_run_id}`} key="run">
                {event.assembly_run_id.slice(0, 8)}
              </Link>
            ) : (
              "—"
            ),
            event.elapsed_since_claim_ms === null
              ? "—"
              : formatElapsed(event.elapsed_since_claim_ms),
          ]}
        />
      )}
    </div>
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
