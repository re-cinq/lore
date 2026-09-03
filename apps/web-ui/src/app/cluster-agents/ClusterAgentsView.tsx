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
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Tags</th>
              <th>Status</th>
              <th>Last seen</th>
              <th>Running claims</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.id}>
                <td>{agent.name}</td>
                <td>
                  {agent.tags.length === 0
                    ? "—"
                    : agent.tags.map((tag) => (
                        <span key={tag} className="badge badge-gray">
                          {tag}
                        </span>
                      ))}
                </td>
                <td>
                  <span
                    className={`badge ${
                      agent.status === "offline" ? "badge-red" : "badge-green"
                    }`}
                  >
                    {agent.status}
                  </span>
                  {/* Liveness and paused status are independent; both badges can show. */}
                  {agent.paused && (
                    <span className="badge badge-gray">paused</span>
                  )}
                </td>
                <td>
                  <TimeAgo date={agent.last_seen_at} />
                </td>
                <td>
                  {agent.running_claims > 0 ? (
                    <Link href={`/assembly-runs?cluster_agent_id=${agent.id}`}>
                      {agent.running_claims}
                    </Link>
                  ) : (
                    agent.running_claims
                  )}
                </td>
                <td>
                  {/* BOUND via .bind() — inline arrow would not serialize to client component. */}
                  <PauseClusterButton
                    paused={agent.paused}
                    toggle={togglePaused.bind(null, agent.id)}
                  />
                  {agent.name === CENTRAL_CLUSTER_AGENT_NAME && (
                    <RestartClusterButton
                      restart={restart.bind(null, agent.id)}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Recent offline events</h2>
      <p className="meta">
        A row appears when the reaper marks a cluster offline and requeues a
        station run it held — a flapping cluster shows up here.
      </p>
      {offlineEvents.length === 0 ? (
        <Alert variant="secondary">No offline events recorded.</Alert>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Cluster</th>
              <th>Node</th>
              <th>Assembly run</th>
              <th>Held for</th>
            </tr>
          </thead>
          <tbody>
            {offlineEvents.map((event, index) => (
              <tr key={`${event.created_at}-${event.station_run_id ?? index}`}>
                <td>
                  <TimeAgo date={event.created_at} />
                </td>
                <td>
                  {event.cluster_agent_id
                    ? (nameById.get(event.cluster_agent_id) ??
                      event.cluster_agent_id)
                    : "—"}
                </td>
                <td>{event.node_id ?? "—"}</td>
                <td>
                  {event.assembly_run_id ? (
                    <Link href={`/assembly-runs/${event.assembly_run_id}`}>
                      {event.assembly_run_id.slice(0, 8)}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {event.elapsed_since_claim_ms === null
                    ? "—"
                    : formatElapsed(event.elapsed_since_claim_ms)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
