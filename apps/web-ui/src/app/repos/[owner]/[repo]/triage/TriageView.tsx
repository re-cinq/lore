import Link from "next/link";
import type { TriageIssue } from "@/lib/api/triage";

interface TriageViewProps {
  issues: readonly TriageIssue[];
}

export default function TriageView({ issues }: TriageViewProps) {
  if (issues.length === 0) {
    return <p className="muted">No open issues carry a triage label.</p>;
  }

  return (
    <>
      {[...groupByLabel(issues)].map(([label, group]) => (
        <TriageGroup key={label} label={label} issues={group} />
      ))}
    </>
  );
}

function groupByLabel(
  issues: readonly TriageIssue[],
): Map<string, TriageIssue[]> {
  return issues.reduce(
    (groups, issue) =>
      groups.set(issue.triage_label, [
        ...(groups.get(issue.triage_label) ?? []),
        issue,
      ]),
    new Map<string, TriageIssue[]>(),
  );
}

function TriageGroup({
  label,
  issues,
}: {
  label: string;
  issues: TriageIssue[];
}) {
  const headingId = `triage-${label.replace(/\W+/g, "-")}`;

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{label}</h2>
      <TriageTable issues={issues} />
    </section>
  );
}

function TriageTable({ issues }: { issues: TriageIssue[] }) {
  return (
    <table className="table">
      <TriageHead />
      <tbody>
        {issues.map((issue, index) => (
          <TriageRow key={`${issue.title}-${index}`} issue={issue} />
        ))}
      </tbody>
    </table>
  );
}

function TriageRow({ issue }: { issue: TriageIssue }) {
  return (
    <tr>
      <td>{issue.title}</td>
      <td>{issue.triage_label}</td>
      <td>
        {issue.active_run_link && (
          <Link href={issue.active_run_link}>View run</Link>
        )}
      </td>
    </tr>
  );
}

function TriageHead() {
  return (
    <thead>
      <tr>
        <th>Issue</th>
        <th>Status</th>
        <th>Run</th>
      </tr>
    </thead>
  );
}
