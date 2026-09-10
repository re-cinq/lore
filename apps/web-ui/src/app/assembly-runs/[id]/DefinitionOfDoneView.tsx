// The Definition of Done as the run page shows it (specs/implementation-loop FR16): the pass count in the card's header, each acceptance test with its CI verdict, then the claim, the strategy and what was ruled out. Pure render; the panel above owns the fetch.
import CollapsibleCard from "@/components/CollapsibleCard";
import {
  dodSummary,
  statusGlyph,
  type AcceptanceTestStatus,
  type DodProgress,
} from "@/lib/dod-progress-view";
import styles from "./DefinitionOfDoneView.module.css";

const STATUS_CLASS: Record<AcceptanceTestStatus["status"], string> = {
  pass: styles.pass,
  fail: styles.fail,
  unknown: styles.unknown,
};

export interface DefinitionOfDoneViewProps {
  progress: DodProgress;
}

const EMPTY =
  "No definition of done on this run's branch — the acceptance-dod step has not written one yet, or pr-ready has already removed it.";

/** A run with no `.lore/dod.md` on its branch renders the empty state rather than a bare header. */
export default function DefinitionOfDoneView({
  progress,
}: DefinitionOfDoneViewProps) {
  if (!progress.present) {
    return (
      <CollapsibleCard
        title="Definition of Done"
        defaultOpen
        emptyState={EMPTY}
      />
    );
  }

  return <PresentCard progress={progress} />;
}

/** The card with a definition to show: the pass count in its header, then the tests, facets and claim. */
function PresentCard({ progress }: DefinitionOfDoneViewProps) {
  const summary = dodSummary(progress);

  return (
    <CollapsibleCard
      title="Definition of Done"
      defaultOpen
      status={{ label: summary.label, tone: summary.tone }}
      hint={summary.hint}
    >
      <AcceptanceTests tests={progress.acceptanceTests ?? []} />
      <Facets facets={progress.facets} />
      <Claim progress={progress} />
    </CollapsibleCard>
  );
}

function AcceptanceTests({
  tests,
}: {
  tests: readonly AcceptanceTestStatus[];
}) {
  return (
    <ul className={styles.tests}>
      {tests.map((test) => (
        <AcceptanceTestRow key={`${test.path}::${test.name}`} test={test} />
      ))}
    </ul>
  );
}

function Facets({ facets }: { facets: DodProgress["facets"] }) {
  if (!facets || facets.length === 0) {
    return null;
  }

  return (
    <ul className={styles.facets}>
      {facets.map((facet) => (
        <li key={facet.text} data-facet={facet.done ? "done" : "open"}>
          <span className={styles.glyph}>{facet.done ? "☑" : "☐"}</span>
          {facet.text}
        </li>
      ))}
    </ul>
  );
}

function Claim({ progress }: { progress: DodProgress }) {
  return (
    <dl className={styles.claim}>
      <dt>Claim</dt>
      <dd>{progress.ticketClaim}</dd>
      <dt>Strategy</dt>
      <dd>
        <span className={styles.strategy}>{progress.strategy}</span>{" "}
        {progress.why}
      </dd>
      <OutOfScope excluded={progress.outOfScope} />
    </dl>
  );
}

function AcceptanceTestRow({ test }: { test: AcceptanceTestStatus }) {
  return (
    <li className={styles.test} data-acceptance={test.status}>
      <span className={`${styles.glyph} ${STATUS_CLASS[test.status]}`}>
        {statusGlyph(test.status)}
      </span>
      <span className={styles.testBody}>
        <span className={styles.testName}>
          {test.path}
          <span className={styles.separator}>::</span>
          {test.name}
        </span>
        <span className={styles.behaviour}>{test.behaviour}</span>
        {test.status === "unknown" && (
          <span className={styles.note}>not in the latest CI report</span>
        )}
      </span>
    </li>
  );
}

function OutOfScope({ excluded }: { excluded: DodProgress["outOfScope"] }) {
  if (!excluded || excluded.length === 0) {
    return null;
  }

  return (
    <>
      <dt>Out of scope</dt>
      <dd>{excluded.join(" · ")}</dd>
    </>
  );
}
