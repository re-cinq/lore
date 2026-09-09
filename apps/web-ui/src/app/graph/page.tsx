export const dynamic = "force-dynamic";
import { getGraphBrowse } from "@/lib/api/memory";
import GraphView, {
  type Entity,
  type Edge,
  type Stats,
  type EntityTypeCount,
} from "./GraphView";

/** The graph as it stands, or an empty one. An unreachable lore-api renders the browser with no entities rather than an error: the view's own empty state says to write episodes, which is the right next step on a fresh install too. */
async function readGraph(query: {
  entity?: string;
  type?: string;
  showInvalid: boolean;
}) {
  const browse = await getGraphBrowse(query);

  return browse.status === "ok"
    ? browse.data
    : { stats: {}, entity_types: [], entities: [], edges: [] };
}

interface GraphPageProps {
  searchParams: Promise<{
    entity?: string;
    type?: string;
    show_invalid?: string;
  }>;
}

export default async function GraphPage({ searchParams }: GraphPageProps) {
  const { entity, type, show_invalid } = await searchParams;
  const showInvalid = show_invalid === "1";

  const graph = await readGraph({ entity, type, showInvalid });

  return (
    <GraphView
      entity={entity}
      type={type}
      showInvalid={showInvalid}
      stats={graph.stats as unknown as Stats}
      entityTypes={graph.entity_types as unknown as EntityTypeCount[]}
      entities={graph.entities as unknown as Entity[]}
      edges={graph.edges as unknown as Edge[]}
    />
  );
}
