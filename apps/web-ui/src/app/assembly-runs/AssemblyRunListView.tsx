import type { AssemblyRun } from "@/lib/assembly-runs";
import { runStatusVisual } from "@/lib/assembly-run-presenter";
import { connectionLabel } from "@/lib/run-stream-presenter";
import type { ChannelState } from "@/lib/live-socket/connection-machine";
import type { ReactNode } from "react";
import AssemblyRunsTable from "./AssemblyRunsTable";
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
  /** Where the filter and page links point; the global list by default. */
  basePath?: string;
  /** Shown in place of the default "Assembly runs" heading. */
  heading?: ReactNode;
}

const GLOBAL_RUNS_PATH = "/assembly-runs";

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
  const { basePath = GLOBAL_RUNS_PATH, activeStatus } = props;

  return (
    <div className={styles.page}>
      <RunListHeader connection={props.connection} heading={props.heading} />
      <StatusFilterBar activeStatus={activeStatus} basePath={basePath} />
      <AssemblyRunsTable runs={props.runs} showStages />
      <PageLinks
        basePath={basePath}
        activeStatus={activeStatus}
        cursor={props.cursor}
        nextCursor={props.nextCursor}
      />
    </div>
  );
}

interface PageLinksProps extends Pick<
  AssemblyRunListViewProps,
  "activeStatus" | "cursor" | "nextCursor"
> {
  basePath: string;
}

function PageLinks({
  basePath,
  activeStatus,
  cursor,
  nextCursor,
}: PageLinksProps) {
  const hrefAt = (page?: string) =>
    runsHref(basePath, { status: activeStatus, cursor: page });

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

function runsHref(
  basePath: string,
  query: { status?: string; cursor?: string },
): string {
  const params = new URLSearchParams();

  if (query.status) {
    params.set("status", query.status);
  }

  if (query.cursor) {
    params.set("cursor", query.cursor);
  }

  return params.size > 0 ? `${basePath}?${params}` : basePath;
}

function StatusFilterBar(props: { activeStatus?: string; basePath: string }) {
  const { activeStatus, basePath } = props;

  return (
    <nav className={styles.chips} aria-label="Status">
      {[undefined, ...FILTERS].map((status) => (
        <FilterLink
          key={status ?? "all"}
          href={runsHref(basePath, { status })}
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
  heading = <DefaultHeading />,
}: Pick<AssemblyRunListViewProps, "connection" | "heading">) {
  return (
    <div className={styles.header}>
      {heading}
      {connection && <ConnectionChip state={connection} />}
    </div>
  );
}

/** The page's own title: the section it sits in, its name, and what it lists. */
function DefaultHeading() {
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
