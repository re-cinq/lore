export const dynamic = "force-dynamic";
import { fetchRunBlob } from "@/lib/run-blob";
import RunBlobView from "../../RunBlobView";

const WITHOUT_BLOB = {
  denied: "You do not have access to this run's repository.",
  "not-found": "This run does not reference that blob.",
  unavailable: "The blob could not be read just now. Reload to try again.",
} as const;

// A blob the run page's Needs card links to: markdown rendered, other text verbatim. Only blobs the run itself references open.
export default async function RunBlobPage({
  params,
}: {
  params: Promise<{ id: string; hash: string }>;
}) {
  const { id, hash } = await params;
  const result = await fetchRunBlob(id, hash);

  return result.status === "ok" ? (
    <RunBlobView runId={id} blob={result.blob} />
  ) : (
    <p>{WITHOUT_BLOB[result.status]}</p>
  );
}
