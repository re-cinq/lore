export const dynamic = "force-dynamic";
import { getEntity } from "@/lib/api/entities";
import EntityView from "./EntityView";

interface EntityPageProps {
  params: Promise<{ name: string }>;
}

/** `/entities/<name>`: one knowledge-graph entity, its relationships over time and what memory says about it. */
export default async function EntityPage({ params }: EntityPageProps) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);

  return <EntityView name={decoded} entity={await getEntity(decoded)} />;
}
