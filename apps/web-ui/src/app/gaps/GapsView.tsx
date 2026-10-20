import { TimeAgo } from "@/components/TimeAgo";
import Icon from "@/components/Icon";
import { InsightsHeading } from "@/components/insights/InsightsHeading";
import { InsightsCard } from "@/components/insights/InsightsCard";
import type { MemoryAuditEntry } from "@/lib/api/activity";
import { groupSearches, type SearchGroup } from "./group-searches";
import styles from "./GapsView.module.css";

export type ZeroResultSearchRow = Pick<
  MemoryAuditEntry,
  "memory_key" | "metadata" | "created_at"
>;

export interface GapMemoryRow {
  key: string;
  value: string;
  created_at: string;
}

export interface GapsViewProps {
  gapMemories: GapMemoryRow[];
  zeroResultSearches: ZeroResultSearchRow[];
}

const DRAFT_PRS_URL =
  "https://github.com/re-cinq/lore/pulls?q=label:context-gap-draft";

const LEDE = (
  <>
    Context the org is missing, across all repos: what the gap agent found, and
    what people searched for and got nothing back. For one repo&apos;s gaps,
    open it from <a href="/">Repositories</a>.
  </>
);

/** Gap detection view; pure render with audit_log and memories from container (read-only). */
export default function GapsView({
  gapMemories,
  zeroResultSearches,
}: GapsViewProps) {
  return (
    <div>
      <InsightsHeading title="Gaps" lede={LEDE} />
      <DraftPrsBanner />
      <AgentFindings gapMemories={gapMemories} />
      <ZeroResultSearches zeroResultSearches={zeroResultSearches} />
    </div>
  );
}

const BANNER_NOTE =
  "The gap agent opens a draft PR when it finds missing context. They live on GitHub under the context-gap-draft label.";

/** Where the gap agent's own output goes. The PRs live on GitHub rather than in this page, so the banner is a signpost. */
function DraftPrsBanner() {
  return (
    <section className={styles.banner} aria-label="Context gap draft PRs">
      <span className={styles.bannerText}>
        <h2 className={styles.bannerTitle}>Draft PRs fill context gaps</h2>
        <span className={styles.bannerNote}>{BANNER_NOTE}</span>
      </span>
      <a
        href={DRAFT_PRS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.bannerLink}
      >
        View on GitHub
        <Icon name="external" size={14} />
      </a>
    </section>
  );
}

function AgentFindings({ gapMemories }: Pick<GapsViewProps, "gapMemories">) {
  return (
    <section className={styles.findings} aria-label="Gap agent findings">
      <h2 className={styles.findingsTitle}>Gap agent findings</h2>
      {gapMemories.length === 0 ? (
        <p className={`meta ${styles.empty}`}>
          No findings from the gap detection agent yet.
        </p>
      ) : (
        <div className={styles.findingGrid}>
          {gapMemories.map((mem, i) => (
            <GapFindingCard key={i} memory={mem} />
          ))}
        </div>
      )}
    </section>
  );
}

function GapFindingCard({ memory }: { memory: GapMemoryRow }) {
  return (
    <article className={styles.finding}>
      <span className={`meta ${styles.findingWhen}`}>
        <TimeAgo date={memory.created_at} />
      </span>
      <h3 className={styles.findingKey}>{memory.key}</h3>
      <p className={styles.findingValue}>{memory.value}</p>
    </article>
  );
}

/** A search that returned nothing is the clearest signal of missing org context: someone asked, and there was no answer to give. */
function ZeroResultSearches({
  zeroResultSearches,
}: Pick<GapsViewProps, "zeroResultSearches">) {
  const groups = groupSearches(zeroResultSearches);

  return (
    <InsightsCard
      title="Zero-result searches"
      caption="Most recent searches · grouped by query"
      flush
    >
      {groups.length === 0 ? (
        <p className={`meta ${styles.emptyRow}`}>
          No zero-result searches recorded.
        </p>
      ) : (
        <SearchList groups={groups} />
      )}
    </InsightsCard>
  );
}

function SearchList({ groups }: { groups: SearchGroup[] }) {
  return (
    <ul className={styles.searches} aria-label="Searches with no results">
      {groups.map((g) => (
        <SearchRow key={g.query} group={g} />
      ))}
    </ul>
  );
}

function SearchRow({ group }: { group: SearchGroup }) {
  return (
    <li className={styles.search}>
      <span className={styles.query}>&ldquo;{group.query}&rdquo;</span>
      <span className={styles.asked}>{group.count}&times; asked</span>
      <span className={`meta ${styles.when}`}>
        <TimeAgo date={group.latest} />
      </span>
    </li>
  );
}
