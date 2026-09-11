import CollapsibleCard from "@/components/CollapsibleCard";
import GitHubMarkdown from "@/components/GitHubMarkdown";
import type { Issue } from "@/lib/api/issues";

export interface RunIssueCardProps {
  issue: Issue | null;
}

/** The issue this run works on, readable in place; the header's Issue fact still links out to GitHub. Folded by default, since an issue body can be long and the title in the header already says which issue it is. */
export default function RunIssueCard({ issue }: RunIssueCardProps) {
  if (!issue) {
    return null;
  }

  return (
    <CollapsibleCard
      title={`Issue #${issue.number} · ${issue.title}`}
      status={{
        label: issue.state,
        tone: issue.state === "open" ? "ok" : "idle",
      }}
      emptyState="No description provided."
    >
      {issue.body ? <GitHubMarkdown markdown={issue.body} /> : null}
    </CollapsibleCard>
  );
}
