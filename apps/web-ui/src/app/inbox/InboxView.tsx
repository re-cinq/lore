"use client";

import { useState } from "react";
import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import { TimeAgo } from "@/components/TimeAgo";
import { formatEnumLabel } from "@/lib/enum-label";
import type { InboxEntry, InboxKind } from "@/lib/api/inbox";
import styles from "./InboxView.module.css";

const LEDE =
  "Everything across your repos that has stopped and is waiting for a person.";

export interface InboxViewProps {
  entries: InboxEntry[];
  counts: Partial<Record<InboxKind, number>>;
  unavailable?: string[];
  selectedKinds?: InboxKind[];
}

export default function InboxView(props: InboxViewProps) {
  const { entries, counts, unavailable = [], selectedKinds = [] } = props;
  const selection = useInboxSelection(entries, selectedKinds);

  return (
    <div>
      <ScreenHeader group="work" title="Inbox" lede={LEDE} />
      <KindChips
        counts={counts}
        activeKinds={selection.activeKinds}
        onToggle={selection.onToggle}
      />
      <UnavailableNotice sources={unavailable} />
      <InboxSplit
        entries={selection.visible}
        selected={selection.selected}
        onSelect={selection.setSelectedId}
      />
    </div>
  );
}

function useInboxSelection(entries: InboxEntry[], selectedKinds: InboxKind[]) {
  const [activeKinds, setActiveKinds] = useState<InboxKind[]>(selectedKinds);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const visible = sortedByWait(filterByKinds(entries, activeKinds));
  const selected = resolveSelected(visible, selectedId);
  const onToggle = (kind: InboxKind) =>
    setActiveKinds((cur) => toggleKind(cur, kind));

  return { activeKinds, visible, selected, onToggle, setSelectedId };
}

function filterByKinds(
  entries: InboxEntry[],
  kinds: readonly InboxKind[],
): InboxEntry[] {
  return kinds.length === 0
    ? entries
    : entries.filter((entry) => kinds.includes(entry.kind));
}

/** Longest wait first (`waiting_since` ascending, specs/inbox FR1.6 & FR5.2). */
function sortedByWait(entries: InboxEntry[]): InboxEntry[] {
  return [...entries].sort(
    (a, b) => Date.parse(a.waiting_since) - Date.parse(b.waiting_since),
  );
}

function resolveSelected(
  entries: InboxEntry[],
  selectedId: string | null,
): InboxEntry | null {
  return (
    entries.find((entry) => entry.id === selectedId) ?? entries.at(0) ?? null
  );
}

function toggleKind(current: InboxKind[], kind: InboxKind): InboxKind[] {
  return current.includes(kind)
    ? current.filter((existing) => existing !== kind)
    : [...current, kind];
}

interface KindChipsProps {
  counts: Partial<Record<InboxKind, number>>;
  activeKinds: readonly InboxKind[];
  onToggle: (kind: InboxKind) => void;
}

function KindChips({ counts, activeKinds, onToggle }: KindChipsProps) {
  const kinds = Object.keys(counts) as InboxKind[];

  if (kinds.length === 0) {
    return null;
  }

  return (
    <div className={styles.chips} role="group" aria-label="Filter by kind">
      {kinds.map((kind) => (
        <KindChip
          key={kind}
          kind={kind}
          count={counts[kind] ?? 0}
          active={activeKinds.includes(kind)}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

interface KindChipProps {
  kind: InboxKind;
  count: number;
  active: boolean;
  onToggle: (kind: InboxKind) => void;
}

function KindChip({ kind, count, active, onToggle }: KindChipProps) {
  return (
    <button
      type="button"
      className={styles.chip}
      aria-pressed={active}
      onClick={() => onToggle(kind)}
    >
      <span>{formatEnumLabel(kind)}</span>
      <span className={styles.chipCount}>{count}</span>
    </button>
  );
}

function UnavailableNotice({ sources }: { sources: string[] }) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <p role="status" className={styles.unavailable}>
      Unavailable sources: {sources.join(", ")}
    </p>
  );
}

interface InboxSplitProps {
  entries: InboxEntry[];
  selected: InboxEntry | null;
  onSelect: (id: string) => void;
}

function InboxSplit({ entries, selected, onSelect }: InboxSplitProps) {
  if (entries.length === 0) {
    return <p className={styles.empty}>Nothing is waiting.</p>;
  }

  return (
    <div className={styles.split}>
      <EntryList
        entries={entries}
        selectedId={selected?.id ?? null}
        onSelect={onSelect}
      />
      {selected && <DetailPane entry={selected} />}
    </div>
  );
}

interface EntryListProps {
  entries: InboxEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function EntryList({ entries, selectedId, onSelect }: EntryListProps) {
  return (
    <ul className={styles.list} aria-label="Inbox items">
      {entries.map((entry) => (
        <EntryRow
          key={entry.id}
          entry={entry}
          selected={entry.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

interface EntryRowProps {
  entry: InboxEntry;
  selected: boolean;
  onSelect: (id: string) => void;
}

function EntryRow({ entry, selected, onSelect }: EntryRowProps) {
  return (
    <li className={styles.rowItem}>
      <button
        type="button"
        className={styles.rowButton}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(entry.id)}
      >
        <EntryRowHead entry={entry} />
        <strong className={styles.rowTitle}>{entry.title}</strong>
        <span className={styles.rowDetail}>{entry.detail}</span>
      </button>
    </li>
  );
}

function EntryRowHead({ entry }: { entry: InboxEntry }) {
  return (
    <span className={styles.rowHead}>
      <span className={styles.kindBadge}>{formatEnumLabel(entry.kind)}</span>
      <span className={styles.repo}>{entry.repo}</span>
      <span className={styles.wait}>
        <TimeAgo date={entry.waiting_since} inline />
      </span>
    </span>
  );
}

function DetailPane({ entry }: { entry: InboxEntry }) {
  return (
    <aside className={styles.detail} aria-label="Selected item detail">
      <header className={styles.detailHead}>
        <span className={styles.kindBadge}>{formatEnumLabel(entry.kind)}</span>
        <span className={styles.repo}>{entry.repo}</span>
      </header>
      <h2 className={styles.detailTitle}>{entry.title}</h2>
      <p className={styles.detailBody}>{entry.detail}</p>
      <p className={styles.detailWait}>
        Waiting since <TimeAgo date={entry.waiting_since} inline />
      </p>
      <Link href={entry.open_url} className={styles.openLink}>
        Open {formatEnumLabel(entry.kind)}
      </Link>
    </aside>
  );
}
