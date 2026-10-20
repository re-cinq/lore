"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isTypingTarget } from "@/components/shell/shortcut-keys";
import { StatusPill, type StatusTone } from "@/components/StatusPill";
import { formatRelativeTime } from "@/lib/assembly-run-presenter";
import type { InboxItem, InboxKind } from "@/lib/api/inbox";
import { inboxKeyAction } from "./inbox-keys";
import styles from "./InboxList.module.css";

const KIND_PILL: Record<InboxKind, { label: string; tone: StatusTone }> = {
  failed: { label: "Failed", tone: "err" },
  waiting: { label: "Waiting", tone: "waiting" },
};

interface InboxListProps {
  entries: InboxItem[];
  nowMs?: number;
}

/** The entries as cards, one of them selected; j/k move the selection, e opens its run. */
export default function InboxList({ entries, nowMs }: InboxListProps) {
  const [selected, setSelected] = useState(0);

  useInboxKeys(entries, selected, setSelected);

  return (
    <ul className={styles.list} aria-label="Waiting on a person">
      {entries.map((entry, index) => (
        <InboxCard
          key={`${entry.kind}-${entry.runId}`}
          entry={entry}
          nowMs={nowMs}
          selected={index === selected}
          onSelect={() => setSelected(index)}
        />
      ))}
    </ul>
  );
}

function useInboxKeys(
  entries: InboxItem[],
  selected: number,
  setSelected: (index: number) => void,
) {
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = keyActionOf(e, selected, entries.length);

      if (action?.type === "move") {
        setSelected(action.index);
      }

      if (action?.type === "open") {
        router.push(`/assembly-runs/${entries[selected]?.runId}`);
      }
    };

    document.addEventListener("keydown", onKey);

    return () => document.removeEventListener("keydown", onKey);
  }, [entries, selected, setSelected, router]);
}

/** A key typed into a field belongs to the field, not the inbox. */
function keyActionOf(e: KeyboardEvent, selected: number, count: number) {
  return isTypingTarget(e.target)
    ? null
    : inboxKeyAction(e.key, selected, count);
}

interface InboxCardProps {
  entry: InboxItem;
  nowMs?: number;
  selected: boolean;
  onSelect: () => void;
}

function InboxCard({ entry, nowMs, selected, onSelect }: InboxCardProps) {
  return (
    <li
      className={selected ? `${styles.card} ${styles.selected}` : styles.card}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      data-testid="inbox-item"
    >
      <span className={styles.text}>
        <CardMeta entry={entry} nowMs={nowMs} />
        <span className={styles.title}>{entry.title}</span>
        <span className={styles.body}>{entry.body}</span>
      </span>
      <CardActions entry={entry} />
    </li>
  );
}

function CardMeta({ entry, nowMs }: { entry: InboxItem; nowMs?: number }) {
  const pill = KIND_PILL[entry.kind];

  return (
    <span className={styles.meta}>
      <StatusPill label={pill.label} tone={pill.tone} />
      <span>{entry.repo}</span>
      <span suppressHydrationWarning>
        · waiting since {formatRelativeTime(entry.since, nowMs)}
      </span>
    </span>
  );
}

function CardActions({ entry }: { entry: InboxItem }) {
  return (
    <span className={styles.actions}>
      {entry.link ? (
        <a
          href={entry.link.href}
          className={styles.secondary}
          target="_blank"
          rel="noreferrer"
        >
          {entry.link.label}
        </a>
      ) : null}
      <Link href={`/assembly-runs/${entry.runId}`} className={styles.primary}>
        Open run
      </Link>
    </span>
  );
}
