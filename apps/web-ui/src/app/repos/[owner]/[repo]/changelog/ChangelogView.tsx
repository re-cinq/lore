import Link from "next/link";
import type { ChangelogPage, ChangelogWeek } from "@/lib/api/changelog";
import Markdown from "@/components/Markdown";
import Changes, { type Grouping } from "./Changes";
import { weekTitle } from "./group-changes";
import styles from "./ChangelogView.module.scss";
import ReleaseNowButton from "./ReleaseNowButton";
import type { ReleaseNow } from "./release-now-outcome";
import ReleasesView from "./ReleasesView";
import WriteIntroButton, { type WriteIntro } from "./WriteIntroButton";

export type { Grouping };

interface ChangelogViewProps {
  base: string;
  page: ChangelogPage;
  grouping: Grouping;
  /** The page's own `before`, kept when the grouping is switched. */
  before?: string;
  /** Starts a finished week's introduction again, for a week left without one. */
  writeIntro: WriteIntro;
  /** Starts a release for the repository; without it the page offers none. */
  releaseNow?: ReleaseNow;
}

/** The repository's weeks newest first, each opening with what it delivered (specs/repo-changelog FR6), or its releases once it has them (FR7). */
export default function ChangelogView(props: ChangelogViewProps) {
  const { base, page, grouping, before } = props;

  return (
    <div>
      <GroupingSwitch base={base} grouping={grouping} before={before} />
      <Sections {...props} />
      {page.next && (
        <div className={styles.older}>
          <Link href={hrefOf(base, { before: page.next, grouping })}>
            {page.mode === "releases" ? "Older releases" : "Older weeks"}
          </Link>
        </div>
      )}
    </div>
  );
}

function Sections({
  page,
  grouping,
  writeIntro,
  releaseNow,
}: ChangelogViewProps) {
  if (page.mode === "releases") {
    return (
      <ReleasesView page={page} grouping={grouping} releaseNow={releaseNow} />
    );
  }

  return (
    <>
      <FirstRelease releaseNow={releaseNow} />
      {page.weeks.map((week) => (
        <WeekSection key={week.weekKey} {...{ week, grouping, writeIntro }} />
      ))}
    </>
  );
}

/** A repository with no release yet can make its first on demand, with no schedule. */
function FirstRelease({ releaseNow }: { releaseNow?: ReleaseNow }) {
  if (!releaseNow) {
    return null;
  }

  return (
    <section className={styles.week} aria-label="Release">
      <p className={styles.note}>
        From the first release on, this page lists releases instead of weeks.
      </p>
      <ReleaseNowButton
        unreleased={null}
        latestVersion={null}
        releaseNow={releaseNow}
      />
    </section>
  );
}

/** "By person" with an On/Off pill like a loop's switch: green with a dot when the week is grouped by person. A link, not a form: the grouping lives in the URL. */
function GroupingSwitch(props: {
  base: string;
  grouping: Grouping;
  before?: string;
}) {
  const on = props.grouping === "person";
  const next: Grouping = on ? "list" : "person";

  return (
    <div className={styles.toolbar}>
      <span id="by-person-label">By person</span>
      <SwitchLink
        href={hrefOf(props.base, { before: props.before, grouping: next })}
        on={on}
      />
    </div>
  );
}

function SwitchLink({ href, on }: { href: string; on: boolean }) {
  return (
    <Link
      href={href}
      role="switch"
      aria-checked={on}
      aria-labelledby="by-person-label"
      className={`${styles.switch} ${on ? styles.on : styles.off}`}
    >
      <span className={styles.dot} aria-hidden="true" />
      {on ? "On" : "Off"}
    </Link>
  );
}

function hrefOf(
  base: string,
  { before, grouping }: { before?: string; grouping: Grouping },
): string {
  const query = new URLSearchParams({
    ...(before ? { before } : {}),
    ...(grouping === "person" ? { by: "person" } : {}),
  }).toString();

  return query ? `${base}?${query}` : base;
}

function WeekSection({
  week,
  grouping,
  writeIntro,
}: {
  week: ChangelogWeek;
  grouping: Grouping;
  writeIntro: WriteIntro;
}) {
  return (
    <section className={styles.week} aria-label={weekTitle(week)}>
      <h3 className={styles.title}>
        {weekTitle(week)}
        {week.current && <span className={styles.current}>this week</span>}
      </h3>
      <WeekIntro week={week} writeIntro={writeIntro} />
      <Changes changes={week.changes} grouping={grouping} />
    </section>
  );
}

function WeekIntro({
  week,
  writeIntro,
}: {
  week: ChangelogWeek;
  writeIntro: WriteIntro;
}) {
  if (week.intro) {
    return <Markdown markdown={week.intro} className={styles.intro} />;
  }

  return (
    <div className={styles.note}>
      <p>{missingIntro(week)}</p>
      {!week.current && week.changes.length > 0 && (
        <WriteIntroButton week={week.weekKey} writeIntro={writeIntro} />
      )}
    </div>
  );
}

function missingIntro(week: ChangelogWeek): string {
  if (week.changes.length === 0) {
    return "Nothing merged or closed this week.";
  }

  return week.current
    ? "No introduction yet: it is written when the week ends."
    : "No introduction was written for this week.";
}
