import { Alert } from "@/components/Alert";
import { getTriageIssues } from "@/lib/api/triage";
import TriageView from "./TriageView";

interface TriagePageProps {
  params: Promise<{ owner: string; repo: string }>;
}

export default async function TriagePage(props: TriagePageProps) {
  const { owner, repo } = await props.params;
  const result = await getTriageIssues(`${owner}/${repo}`);

  if (result.status !== "ok") {
    const reason =
      result.status === "error" ? result.message : "Lore API unconfigured";

    return (
      <Alert variant="secondary">
        Could not load triage issues ({reason}) — check the Lore API connection
        and reload.
      </Alert>
    );
  }

  return <TriageView issues={result.data} />;
}
