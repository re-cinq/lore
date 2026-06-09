export const dynamic = "force-dynamic";
import { fetchAllSpecs } from '@/lib/trace-api';
import GlobalSpecsView from './GlobalSpecsView';

export default async function SpecsPage() {
  // The spec-traceability graph is the source of truth — list every spec
  // document it holds across all repos (not Postgres chunks).
  const specs = await fetchAllSpecs();

  return (
    <div>
      <h1>Specifications</h1>
      <p className="meta" style={{ marginBottom: 16 }}>
        Spec documents in the traceability graph across all repos ({specs.length}).
      </p>
      <GlobalSpecsView specs={specs} />
    </div>
  );
}
