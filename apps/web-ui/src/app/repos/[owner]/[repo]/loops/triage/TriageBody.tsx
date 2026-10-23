import { Alert } from "@/components/Alert";
import { getTriageIssues } from "@/lib/api/triage";
import TriageView from "./TriageView";

/** The issue-triage loop's page under its switch: every open issue carrying a triage label, grouped by it. */
export default async function TriageBody({ fullName }: { fullName: string }) {
  const result = await getTriageIssues(fullName);

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
