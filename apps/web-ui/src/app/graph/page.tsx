export const dynamic = "force-dynamic";
import { getGraphBrowse } from "@/lib/api/memory";
import GraphView, {
  type Entity,
  type Edge,
  type Stats,
  type EntityTypeCount,
} from "./GraphView";

export default async function GraphPage({
  searchParams,
}: {
  searchParams: Promise<{
    entity?: string;
    type?: string;
    show_invalid?: string;
  }>;
}) {
  const { entity, type, show_invalid } = await searchParams;
  const showInvalid = show_invalid === "1";

  const browse = await getGraphBrowse({ entity, type, showInvalid });
  const data =
    browse.status === "ok"
      ? browse.data
      : { stats: {}, entity_types: [], entities: [], edges: [] };
  const stats = data.stats as unknown as Stats;
  const entityTypes = data.entity_types as unknown as EntityTypeCount[];
  const entities = data.entities as unknown as Entity[];
  const edges = data.edges as unknown as Edge[];

  return (
    <GraphView
      entity={entity}
      type={type}
      showInvalid={showInvalid}
      stats={stats}
      entityTypes={entityTypes}
      entities={entities}
      edges={edges}
    />
  );
}
