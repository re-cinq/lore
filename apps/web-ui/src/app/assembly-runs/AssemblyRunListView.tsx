import type { AssemblyRun } from "@/lib/assembly-runs";
import { runStatusVisual } from "@/lib/assembly-run-presenter";
import { connectionLabel } from "@/lib/run-stream-presenter";
import type { ChannelState } from "@/lib/live-socket/connection-machine";
import type { ReactNode } from "react";
import AssemblyRunsTable from "./AssemblyRunsTable";
import RepoFilter from "./RepoFilter";
import { runsHref } from "./runs-href";
import styles from "./AssemblyRunListView.module.css";

export interface AssemblyRunListViewProps {
  /** The active status filter, or undefined for "All". */
  activeStatus?: string;
  runs: AssemblyRun[];
  /** The keyset cursor this page was read at; absent on the first page. */
  cursor?: string;
  nextCursor?: string | null;
  /** The live channel's state; the chip shows only when given. */
  connection?: ChannelState;
  /** `owner/name` of the repository the list is filtered to, or undefined for every repository. */
  activeRepo?: string;
  /** `owner/name` of every onboarded repository, offered by the repository filter. */
  repos?: string[];
}

const CONNECTION_BADGES: Record<ChannelState, string> = {
  live: "badge-green",
  connecting: "badge-gray",
  reconnecting: "badge-gray",
  offline: "badge-red",
};

/** The run status vocabulary — one status per run, so filtering is SQL-side. */
const FILTERS = ["queued", "running", "finished", "failed"] as const;

// Global assembly-runs list, keyed on per-attempt run records. Pure render — page.tsx fetches the status-filtered runs and passes them down.
export default function AssemblyRunListView(props: AssemblyRunListViewProps) {
  const { activeRepo, activeStatus } = props;

  return (
    <div className={styles.page}>
      <RunListHeader connection={props.connection} />
      <div className={styles.filters}>
        <RepoFilter
          repos={props.repos ?? []}
          activeRepo={activeRepo}
          activeStatus={activeStatus}
        />
        <StatusFilterBar activeRepo={activeRepo} activeStatus={activeStatus} />
      </div>
      <AssemblyRunsTable runs={props.runs} showStages />
      <PageLinks
        activeRepo={activeRepo}
        activeStatus={activeStatus}
        cursor={props.cursor}
        nextCursor={props.nextCursor}
      />
    </div>
  );
}

type PageLinksProps = Pick<
  AssemblyRunListViewProps,
  "activeRepo" | "activeStatus" | "cursor" | "nextCursor"
>;

function PageLinks({
  activeRepo,
  activeStatus,
  cursor,
  nextCursor,
}: PageLinksProps) {
  const hrefAt = (page?: string) =>
    runsHref({ repo: activeRepo, status: activeStatus, cursor: page });

  return (
    <nav className={styles.pager} aria-label="Pages">
      {cursor && <PageLink href={hrefAt()}>Newest</PageLink>}
      {nextCursor && <PageLink href={hrefAt(nextCursor)}>Older</PageLink>}
    </nav>
  );
}

function PageLink(props: { href: string; children: ReactNode }) {
  return (
    <a className={styles.chip} href={props.href}>
      {props.children}
    </a>
  );
}

function StatusFilterBar(
  props: Pick<AssemblyRunListViewProps, "activeRepo" | "activeStatus">,
) {
  const { activeRepo, activeStatus } = props;

  return (
    <nav className={styles.chips} aria-label="Status">
      {[undefined, ...FILTERS].map((status) => (
        <FilterLink
          key={status ?? "all"}
          href={runsHref({ repo: activeRepo, status })}
          isActive={activeStatus === status}
        >
          {status ? runStatusVisual(status, null).label : "All"}
        </FilterLink>
      ))}
    </nav>
  );
}

function FilterLink(props: {
  href: string;
  isActive: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={props.href}
      className={`${styles.chip} ${props.isActive ? "active" : ""}`}
      aria-current={props.isActive ? "page" : undefined}
    >
      {props.children}
    </a>
  );
}

function RunListHeader({
  connection,
}: Pick<AssemblyRunListViewProps, "connection">) {
  return (
    <div className={styles.header}>
      <Heading />
      {connection && <ConnectionChip state={connection} />}
    </div>
  );
}

/** The page's own title: the section it sits in, its name, and what it lists. */
function Heading() {
  return (
    <div className={styles.titleBlock}>
      <span className={styles.eyebrow}>{"{work}"}</span>
      <h1>Assembly runs</h1>
      <p className={styles.intro}>
        Every run of every assembly line, across repos.
      </p>
    </div>
  );
}

function ConnectionChip({ state }: { state: ChannelState }) {
  return (
    <span
      data-testid="runs-connection"
      className={`badge ${CONNECTION_BADGES[state]} ${styles.connection}`}
      role="status"
    >
      <span className={styles.liveDot} aria-hidden="true" />
      {connectionLabel(state)}
    </span>
  );
}
