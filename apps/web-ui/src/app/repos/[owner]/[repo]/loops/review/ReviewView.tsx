import MiniPipeline from "@/components/MiniPipeline";
import Panel from "@/components/Panel";
import type { CodeReview, ReviewRow } from "@/lib/api/code-review";
import LoopTable, { ActionsCell, KindPill, StatusCell } from "../LoopTable";
import styles from "./ReviewView.module.scss";

/** Pure view (DDAU) of the code-review loop: three groups in the order a pull request moves through them. */
export default function ReviewView({ review }: { review: CodeReview }) {
  return (
    <div className={styles.sections}>
      <ReviewExplainer />
      {reviewStages(review).map((stage) => (
        <ReviewSection key={stage.heading} {...stage} />
      ))}
    </div>
  );
}

/** The groups in the order a pull request moves through them. */
function reviewStages(review: CodeReview): ReviewSectionProps[] {
  return [
    {
      heading: "Current",
      rows: review.current,
      emptyText: "No pull request is being reviewed right now.",
    },
    {
      heading: "Open pull requests",
      rows: review.open_pulls,
      emptyText: "No other pull request is open.",
    },
    {
      heading: "Recently reviewed",
      rows: review.recent,
      emptyText: "Nothing reviewed yet.",
    },
  ];
}

function ReviewExplainer() {
  return (
    <p className={`meta ${styles.howTo}`}>
      While the loop is on, every pull request is reviewed when it opens and
      re-checked on every push; a request for changes from a trusted reviewer is
      answered on the pull request. A draft is skipped until it is marked ready.{" "}
      <code>@lore review</code> on a pull request asks for a review whatever the
      switch says.
    </p>
  );
}

interface ReviewSectionProps {
  heading: string;
  rows: readonly ReviewRow[];
  emptyText: string;
}

function ReviewSection({ heading, rows, emptyText }: ReviewSectionProps) {
  return (
    <Panel title={heading}>
      <LoopTable
        subject="Pull request"
        emptyText={emptyText}
        testId="review-table"
        rows={rows.map((row, i) => (
          <ReviewRowView key={`${row.run_id ?? row.pr_url}-${i}`} row={row} />
        ))}
      />
    </Panel>
  );
}

function ReviewRowView({ row }: { row: ReviewRow }) {
  return (
    <tr data-testid="review-row">
      <StatusCell state={row.state} since={row.created_at} />
      <td>
        <PullLink row={row} />
        {row.line && <KindPill>{row.line}</KindPill>}
      </td>
      <td>
        {row.pipeline && row.run_id && (
          <MiniPipeline runId={row.run_id} pipeline={row.pipeline} />
        )}
      </td>
      <ActionsCell
        runId={row.run_id}
        external={row.pr_url ? { href: row.pr_url, text: "PR" } : null}
      />
    </tr>
  );
}

/** The pull request reference, linked out when the row knows its URL. */
function PullLink({ row }: { row: ReviewRow }) {
  const label = row.pr_number ? `#${row.pr_number} ${row.title}` : row.title;

  return row.pr_url ? (
    <a href={row.pr_url} target="_blank" rel="noreferrer">
      {label}
    </a>
  ) : (
    <span>{label}</span>
  );
}
