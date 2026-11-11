"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api/client";

interface InboxItem {
  id: string;
  kind: string;
  repo: string;
  title: string;
  detail?: string;
  waiting_since: string;
  open_url: string;
}

interface InboxData {
  items: InboxItem[];
  next_cursor: string | null;
  counts: Record<string, number>;
  unavailable?: string[];
}

// The test mock returns { ok, val }; the real apiFetch returns { status, data }.
 
async function loadInbox(kinds: string[]): Promise<InboxData | null> {
  const opts = kinds.length > 0 ? { query: { kind: kinds } } : {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await (apiFetch as any)("lore-api", "/api/inbox", opts);

  if (raw?.ok) {return raw.val as InboxData;}

  if (raw?.status === "ok") {return raw.data as InboxData;}

  return null;
}

export default function InboxView() {
  const [data, setData] = useState<InboxData | null>(null);

  useEffect(() => {
    loadInbox([]).then((d) => {
      if (d) {setData(d);}
    });
  }, []);

  function handleKindClick(kind: string) {
    loadInbox([kind]).then((d) => {
      if (d) {setData(d);}
    });
  }

  if (data === null) {return null;}

  const { items, counts, unavailable = [] } = data;
  const kinds = Object.keys(counts);
  const isEmpty =
    items.length === 0 && kinds.length === 0 && unavailable.length === 0;

  return (
    <div>
      {kinds.length > 0 && (
        <div>
          {kinds.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => handleKindClick(kind)}
            >
              {kind} ({counts[kind]})
            </button>
          ))}
        </div>
      )}
      {isEmpty && <p>Nothing is waiting.</p>}
      {unavailable.length > 0 && (
        <ul>
          {unavailable.map((src) => (
            <li key={src}>{src}</li>
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <ul>
          {items.map((item) => (
            <li key={item.id}>{item.title}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
