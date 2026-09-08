// What the hover tooltip says about one statement: whether it is narrative, an untested gap, or validated — and by which tests.

import { resolveHref } from "@/lib/github-links";
import type { StatementInfo } from "@/lib/trace-types";
import styles from "./SpecDetails.module.css";

/** The link's target on the host, with the line anchor when the spec named one. A link with no line still resolves to the file — a test moved within its file is still findable. */
function testLinkHref(
  link: StatementInfo["testLinks"][number],
  repo: string,
  branch: string,
): string {
  const path = `${link.path}${link.line ? `#L${link.line}` : ""}`;

  return resolveHref(path, repo, branch).href;
}

/** One validating test. The path and line are repeated UNDER the link exactly as the spec wrote them, so a reader can see what the link claims without following it — a link whose text and target disagree is how spec drift hides. */
interface TestLinkRowProps {
  link: StatementInfo["testLinks"][number];
  repo: string;
  branch: string;
}

function TestLinkRow({ link, repo, branch }: TestLinkRowProps) {
  return (
    <li>
      <a
        href={testLinkHref(link, repo, branch)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {link.label}
      </a>
      <div className={styles.popoverRationale}>
        {link.path}
        {link.line ? `:${link.line}` : ""}
      </div>
    </li>
  );
}

/** The tests that validate this statement, each linking to its exact line. The rationale under each link repeats the file and line as WRITTEN, so a reader can see what the link claims without following it. */
/** How many tests claim this statement, in the tooltip's own voice rather than as a bare number. */
function TestedCount({ count }: { count: number }) {
  return (
    <strong>
      {count} test{count === 1 ? "" : "s"} validate this
    </strong>
  );
}

interface StatementViewProps {
  statement: StatementInfo;
  repo: string;
  branch: string;
}

function TestedState({ statement, repo, branch }: StatementViewProps) {
  return (
    <div className={styles.popoverTested}>
      <TestedCount count={statement.testLinks.length} />
      <ul className={styles.popoverTestList}>
        {statement.testLinks.map((link, index) => (
          <TestLinkRow
            key={`${link.path}-${link.line ?? ""}-${index}`}
            link={link}
            repo={repo}
            branch={branch}
          />
        ))}
      </ul>
    </div>
  );
}

/** Context rather than a requirement. Says so explicitly, because a reader seeing "no tests" naturally reads a gap — and this one is excluded from the denominator on purpose. */
function NarrativeState({ category }: { category?: string | null }) {
  return (
    <div className={styles.popoverNarrative}>
      <strong>Narrative</strong>
      {category ? ` · ${category}` : ""}
      <div className={styles.popoverHint}>
        Excluded from the coverage denominator — context, not a verifiable
        requirement.
      </div>
    </div>
  );
}

/** A real gap, with the exact syntax that closes it. Showing the form beats naming it: the link goes at the END of the statement, which is the part people get wrong. */
function UntestedState() {
  return (
    <div className={styles.popoverUntested}>
      <strong>Untested</strong>
      <div className={styles.popoverHint}>
        Add an inline test link at end of this statement:{" "}
        <code>([label](path/to/test.ts#L42))</code>
      </div>
    </div>
  );
}

/** What is known about this statement's coverage. Narrative is NOT a gap — it is excluded from the denominator because it states context rather than a verifiable requirement — so it reads differently from untested, which is a gap and says how to close it. */
function StatementState({ statement, repo, branch }: StatementViewProps) {
  if (statement.state === "narrative") {
    return <NarrativeState category={statement.category} />;
  }

  if (statement.state === "untested") {
    return <UntestedState />;
  }

  return <TestedState statement={statement} repo={repo} branch={branch} />;
}

export function StatementPopover({
  statement,
  repo,
  branch,
}: StatementViewProps) {
  return (
    <>
      {statement.drifted && (
        <div className={styles.popoverDrift}>
          <strong>Drifted</strong>
          <div className={styles.popoverHint}>
            The implementation changed since the validating test last passed.
          </div>
        </div>
      )}
      <StatementState statement={statement} repo={repo} branch={branch} />
    </>
  );
}
