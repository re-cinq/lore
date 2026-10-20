import Link from "next/link";
import Icon from "@/components/Icon";
import type { RepoRecord } from "@/lib/api/repos";
import { freshnessIndicator, ingestAge } from "./repo-freshness";
import styles from "./RepoHeader.module.css";

export interface RepoHeaderProps {
  owner: string;
  repo: string;
  /** The GitHub description, when GitHub answered. */
  description?: string | null;
  /** Lore's record of the repo; null when lore-api could not be read. */
  record: Pick<RepoRecord, "team" | "onboarded_at" | "last_ingested_at"> | null;
}

/** The header every repo tab shares: where the reader is, the repo's name, and how its context stands. */
export default function RepoHeader(props: RepoHeaderProps) {
  const { owner, repo, description, record } = props;

  return (
    <header className={styles.header}>
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link href="/">Repositories</Link>
        <span aria-hidden="true">/</span>
        <span className={styles.crumbHere}>
          {owner}/{repo}
        </span>
      </nav>
      <h1 className={styles.title}>{repo}</h1>
      <RepoFacts owner={owner} repo={repo} record={record} />
      {description && <p className={styles.desc}>{description}</p>}
    </header>
  );
}

/** Team, onboarding date, ingest freshness and the GitHub link, on one wrapping line. */
function RepoFacts({
  owner,
  repo,
  record,
}: Omit<RepoHeaderProps, "description">) {
  return (
    <div className={styles.facts}>
      {record?.team && <span className={styles.team}>{record.team}</span>}
      {record && <RecordFacts record={record} />}
      <a
        href={`https://github.com/${owner}/${repo}`}
        target="_blank"
        rel="noreferrer"
        className={styles.github}
      >
        GitHub <Icon name="external" size={12} inline />
      </a>
    </div>
  );
}

function RecordFacts({
  record,
}: {
  record: NonNullable<RepoHeaderProps["record"]>;
}) {
  return (
    <>
      <span>
        Onboarded {new Date(record.onboarded_at).toLocaleDateString()}
      </span>
      <Separator />
      <IngestFact lastIngestedAt={record.last_ingested_at} />
      <Separator />
    </>
  );
}

function Separator() {
  return (
    <span className={styles.sep} aria-hidden="true">
      ·
    </span>
  );
}

/** The ingest age behind the shared freshness dot. */
function IngestFact({ lastIngestedAt }: { lastIngestedAt: string | null }) {
  const fresh = freshnessIndicator(lastIngestedAt);

  return (
    <span className={styles.fresh} title={fresh.label}>
      <span
        className={styles.dot}
        style={{ ["--dot-color" as string]: fresh.color }}
      />
      Ingested {ingestAge(lastIngestedAt)}
    </span>
  );
}
