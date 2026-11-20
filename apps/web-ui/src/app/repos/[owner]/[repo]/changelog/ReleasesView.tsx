import type {
  ChangelogPage,
  ChangelogRelease,
  ChangelogUnreleased,
} from "@/lib/api/changelog";
import Markdown from "@/components/Markdown";
import Changes, { type Grouping } from "./Changes";
import { releaseRange } from "./group-changes";
import styles from "./ChangelogView.module.scss";
import ReleaseNowButton from "./ReleaseNowButton";
import type { ReleaseNow } from "./release-now-outcome";

interface ReleasesViewProps {
  page: ChangelogPage;
  grouping: Grouping;
  releaseNow?: ReleaseNow;
}

/** What is unreleased with its Release now, then the releases newest first, each under its version (specs/repo-changelog FR7). */
export default function ReleasesView(props: ReleasesViewProps) {
  const { page, grouping, releaseNow } = props;
  const { releases = [], unreleased } = page;

  return (
    <>
      {unreleased && (
        <UnreleasedSection {...{ unreleased, grouping, releaseNow }} />
      )}
      {releases.map((release) => (
        <ReleaseSection key={release.version} {...{ release, grouping }} />
      ))}
    </>
  );
}

function UnreleasedSection(props: {
  unreleased: ChangelogUnreleased;
  grouping: Grouping;
  releaseNow?: ReleaseNow;
}) {
  const { changes, latestVersion } = props.unreleased;

  return (
    <section className={styles.week} aria-label="Unreleased">
      <UnreleasedHeading latestVersion={latestVersion} />
      <Changes changes={changes} grouping={props.grouping} />
      {props.releaseNow && (
        <ReleaseNowButton
          unreleased={changes.length}
          latestVersion={latestVersion}
          releaseNow={props.releaseNow}
        />
      )}
    </section>
  );
}

function UnreleasedHeading({
  latestVersion,
}: {
  latestVersion: string | null;
}) {
  return (
    <>
      <h3 className={styles.title}>Unreleased</h3>
      <p className={styles.note}>
        {latestVersion
          ? `Merged and closed since ${latestVersion}.`
          : "Merged and closed since the beginning."}
      </p>
    </>
  );
}

function ReleaseSection({
  release,
  grouping,
}: {
  release: ChangelogRelease;
  grouping: Grouping;
}) {
  return (
    <section className={styles.week} aria-label={release.version}>
      <h3 className={styles.title}>
        {release.version}
        <span className={styles.current}>{release.bump}</span>
      </h3>
      <ReleaseFacts release={release} />
      <Markdown markdown={release.summary} className={styles.intro} />
      <Changes changes={release.changes} grouping={grouping} />
    </section>
  );
}

function ReleaseFacts({ release }: { release: ChangelogRelease }) {
  const { releaseUrl, publishedTo } = release;

  return (
    <p className={styles.note}>
      <span>{releaseRange(release)}</span>
      {releaseUrl && (
        <>
          {" · "}
          <a href={releaseUrl}>GitHub release</a>
        </>
      )}
      {publishedTo && (
        <>
          {" · "}
          <span>Published to {publishedTo}</span>
        </>
      )}
    </p>
  );
}
