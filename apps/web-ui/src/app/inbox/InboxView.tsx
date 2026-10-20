import ScreenHeader from "@/components/ScreenHeader";
import FilterChips, { type FilterChip } from "@/components/FilterChips";
import type { InboxItem, InboxKind } from "@/lib/api/inbox";
import InboxList from "./InboxList";
import styles from "./InboxView.module.css";

export type InboxFilter = InboxKind | "all";

const CHIPS: { id: InboxFilter; label: string; tone: FilterChip["tone"] }[] = [
  { id: "all", label: "All", tone: "neutral" },
  { id: "failed", label: "Failed", tone: "err" },
  { id: "waiting", label: "Waiting", tone: "waiting" },
];

export interface InboxViewProps {
  entries: InboxItem[];
  filter: InboxFilter;
  /** Fixes "now" for tests; the clock otherwise. */
  nowMs?: number;
}

const LEDE =
  "Everything waiting on a person. Failures first, then the longest-waiting.";

/** Everything waiting on a person across repositories, filtered by kind. */
export default function InboxView({ entries, filter, nowMs }: InboxViewProps) {
  const shown = ofKind(entries, filter);

  return (
    <div className={styles.screen}>
      <ScreenHeader group="work" title="Inbox" lede={LEDE} />
      <div className={styles.toolbar}>
        <FilterChips label="Inbox kinds" chips={chipsOf(entries, filter)} />
        <KeyHints />
      </div>
      {shown.length > 0 ? (
        <InboxList entries={shown} nowMs={nowMs} />
      ) : (
        <InboxEmpty />
      )}
    </div>
  );
}

function ofKind(
  entries: readonly InboxItem[],
  filter: InboxFilter,
): InboxItem[] {
  return filter === "all"
    ? [...entries]
    : entries.filter((e) => e.kind === filter);
}

function chipsOf(
  entries: readonly InboxItem[],
  filter: InboxFilter,
): FilterChip[] {
  return CHIPS.map((chip) => ({
    label: chip.label,
    href: chip.id === "all" ? "/inbox" : `/inbox?kind=${chip.id}`,
    active: chip.id === filter,
    tone: chip.tone,
    count: ofKind(entries, chip.id).length,
  }));
}

/** Reads `?kind=`; anything unknown is "all". */
export function parseInboxFilter(
  raw: string | string[] | undefined,
): InboxFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;

  return CHIPS.find((chip) => chip.id === value)?.id ?? "all";
}

const HINTS: [string[], string][] = [
  [["j", "k"], "move"],
  [["e"], "open"],
];

function KeyHints() {
  return (
    <span className={styles.hints} aria-label="Keyboard shortcuts">
      {HINTS.map(([keys, verb]) => (
        <span key={verb} className={styles.hint}>
          {keys.map((k) => (
            <kbd key={k} className={styles.kbd}>
              {k}
            </kbd>
          ))}
          {verb}
        </span>
      ))}
    </span>
  );
}

function InboxEmpty() {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyTitle}>Nothing is waiting on you</span>
      <span className={styles.emptyBody}>
        Failed runs and runs parked at a review or a build land here.
      </span>
    </div>
  );
}
