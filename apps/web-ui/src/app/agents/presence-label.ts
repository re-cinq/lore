import type { AgentPresence } from "@/lib/agents-api";

type ClusterPresence = AgentPresence["clusters"][number];

/** What the presence dot says in words: its tooltip and its accessible name. */
export function presenceLabel(presence: AgentPresence): string {
  if (presence.state === "all") {
    return `On every cluster: ${names(presence.clusters)}`;
  }

  if (presence.state === "none") {
    return "On no cluster yet";
  }

  return [
    "Not live everywhere yet",
    group(
      "Latest",
      presence.clusters.filter((cluster) => cluster.current),
    ),
    group(
      "Older version",
      presence.clusters.filter(
        (cluster) => !cluster.current && cluster.hash !== null,
      ),
    ),
    group(
      "None",
      presence.clusters.filter((cluster) => cluster.hash === null),
    ),
  ]
    .filter(Boolean)
    .join(". ");
}

function group(title: string, clusters: ClusterPresence[]): string {
  return clusters.length > 0 ? `${title}: ${names(clusters)}` : "";
}

function names(clusters: ClusterPresence[]): string {
  return clusters.map((cluster) => cluster.id).join(", ");
}
