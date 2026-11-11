"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api/client";

interface InboxEntry {
  id: string;
  kind: string;
  repo: string;
  title: string;
  detail?: string;
  waiting_since: string;
  open_url: string;
}

interface InboxPayload {
  items: InboxEntry[];
  next_cursor: string | null;
  counts: Record<string, number>;
  unavailable?: string[];
}

export default function InboxView() {
  const [inboxPayload, setInboxPayload] = useState<InboxPayload | null>(null);

  useEffect(() => {
    loadKind([], setInboxPayload);
  }, []);

  if (inboxPayload === null) {
    return null;
  }

  return (
    <InboxContent
      payload={inboxPayload}
      onKindClick={(kind) => loadKind([kind], setInboxPayload)}
    />
  );
}

function InboxContent({
  payload,
  onKindClick,
}: {
  payload: InboxPayload;
  onKindClick: (kind: string) => void;
}) {
  const inboxEntries = payload.items;
  const { counts, unavailable: unavailableSources = [] } = payload;
  const noKinds = Object.keys(counts).length === 0;
  const isEmpty = !inboxEntries.length && noKinds && !unavailableSources.length;

  return (
    <div>
      <KindChips counts={counts} onKindClick={onKindClick} />
      {isEmpty && <p>Nothing is waiting.</p>}
      <UnavailableList unavailableSources={unavailableSources} />
      <EntryList inboxEntries={inboxEntries} />
    </div>
  );
}

interface KindChipsProps {
  counts: Record<string, number>;
  onKindClick: (kind: string) => void;
}

function KindChips({ counts, onKindClick }: KindChipsProps) {
  const kinds = Object.keys(counts);

  if (kinds.length === 0) {
    return null;
  }

  return (
    <div>
      {kinds.map((kind) => (
        <button key={kind} type="button" onClick={() => onKindClick(kind)}>
          {kind} ({counts[kind]})
        </button>
      ))}
    </div>
  );
}

function EntryList({ inboxEntries }: { inboxEntries: InboxEntry[] }) {
  if (inboxEntries.length === 0) {
    return null;
  }

  return (
    <ul>
      {inboxEntries.map((inboxEntry) => (
        <li key={inboxEntry.id}>{inboxEntry.title}</li>
      ))}
    </ul>
  );
}

function UnavailableList({
  unavailableSources,
}: {
  unavailableSources: string[];
}) {
  if (unavailableSources.length === 0) {
    return null;
  }

  return (
    <ul>
      {unavailableSources.map((src) => (
        <li key={src}>{src}</li>
      ))}
    </ul>
  );
}

function loadKind(kinds: string[], set: (p: InboxPayload) => void) {
  void fetchInbox(kinds).then((p) => {
    if (p) {
      set(p);
    }
  });
}

async function fetchInbox(kinds: string[]): Promise<InboxPayload | null> {
  const opts = kinds.length > 0 ? { query: { kind: kinds } } : {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await (apiFetch as any)("lore-api", "/api/inbox", opts);

  if (raw?.ok) {
    return raw.val as InboxPayload;
  }

  if (raw?.status === "ok") {
    return raw.data as InboxPayload;
  }

  return null;
}
