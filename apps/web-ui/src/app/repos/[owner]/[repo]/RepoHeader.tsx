import type { ReactNode } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { githubHost, githubUrls } from "@/lib/github-host";
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
  /** The GitHub host the link opens on; the install's own when left out. */
  host?: string;
  /** The public repository this one is published to (`owner/name`), when it has one. */
  publicMirror?: string | null;
}

/** The header every repo tab shares: where the reader is, the repo's name, and how its context stands. */
export default function RepoHeader(props: RepoHeaderProps) {
  const { owner, repo, description, record, host = githubHost() } = props;

  return (
    <header className={styles.header}>
      <Crumbs owner={owner} repo={repo} />
      <h1 className={styles.title}>{repo}</h1>
      <RepoFacts
        githubHref={`${githubUrls(host).web}/${owner}/${repo}`}
        record={record}
        mirrorChip={<MirrorChip host={host} name={props.publicMirror} />}
      />
      {description && <p className={styles.desc}>{description}</p>}
    </header>
  );
}

function Crumbs({ owner, repo }: { owner: string; repo: string }) {
  return (
    <nav className={styles.crumbs} aria-label="Breadcrumb">
      <Link href="/">Repositories</Link>
      <span aria-hidden="true">/</span>
      <span className={styles.crumbHere}>
        {owner}/{repo}
      </span>
    </nav>
  );
}

interface RepoFactsProps {
  githubHref: string;
  record: RepoHeaderProps["record"];
  mirrorChip: ReactNode;
}

/** Team, onboarding date, ingest freshness and the GitHub link, on one wrapping line. */
function RepoFacts(props: RepoFactsProps) {
  const { githubHref, record, mirrorChip } = props;

  return (
    <div className={styles.facts}>
      {record?.team && <span className={styles.team}>{record.team}</span>}
      {mirrorChip}
      {record && <RecordFacts record={record} />}
      <a
        href={githubHref}
        target="_blank"
        rel="noreferrer"
        className={styles.github}
      >
        GitHub <Icon name="external" size={12} inline />
      </a>
    </div>
  );
}

/** The public repository this one is published to, as a link on the configured host; nothing without a mirror. */
function MirrorChip(props: { host: string; name: string | null | undefined }) {
  if (!props.name) {
    return null;
  }

  return (
    <a
      href={`${githubUrls(props.host).web}/${props.name}`}
      target="_blank"
      rel="noreferrer"
      className={styles.mirror}
    >
      public: {props.name}
    </a>
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
