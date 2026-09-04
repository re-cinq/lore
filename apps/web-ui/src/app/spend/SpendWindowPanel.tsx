"use client";

// Container: owns interval, fetches /api/spend-window, hands response to pure SpendView (DDAU)
import { useEffect, useState } from "react";
import {
  presetInterval,
  spendWindowQuery,
  type SpendPreset,
} from "./spend-window-presets";
import SpendView, { type SpendWindow } from "./SpendView";
import type { RecordTopUpState } from "./actions";
import styles from "./SpendView.module.css";

const PRESETS: Array<{ key: SpendPreset; label: string }> = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "mtd", label: "Month to date" },
];

export default function SpendWindowPanel({
  recordAction,
}: {
  recordAction?: (
    prev: RecordTopUpState | null,
    formData: FormData,
  ) => Promise<RecordTopUpState>;
}) {
  const [interval, setInterval] = useState(() => presetInterval("7d"));
  const { spend, error } = useSpendWindow(interval);

  return (
    <section aria-label="Spend for the selected interval">
      <IntervalPicker interval={interval} onChange={setInterval} />
      {error !== null && <p className="meta">{error}</p>}
      {spend !== null && (
        <SpendView spend={spend} recordAction={recordAction} />
      )}
    </section>
  );
}

/** One fetch per interval, with a cancelled guard so a slow response for a previous interval cannot land over a newer one. */
function useSpendWindow(interval: { from: string; to: string }) {
  const [spend, setSpend] = useState<SpendWindow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(
          `/api/spend-window?${spendWindowQuery(interval)}`,
          { signal: AbortSignal.timeout(30_000) },
        );
        const body = (await res.json()) as SpendWindow & { error?: string };

        if (cancelled) {
          return;
        }

        if (!res.ok) {
          setError(body.error ?? `spend-window returned ${res.status}`);

          return;
        }
        setSpend(body);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [interval]);

  return { spend, error };
}

function IntervalPicker({
  interval,
  onChange,
}: {
  interval: { from: string; to: string };
  onChange: (
    update: (current: { from: string; to: string }) => {
      from: string;
      to: string;
    },
  ) => void;
}) {
  return (
    <div className={styles.presetRow}>
      {PRESETS.map((preset) => (
        <button
          key={preset.key}
          type="button"
          className="btn-secondary"
          onClick={() => onChange(() => presetInterval(preset.key))}
        >
          {preset.label}
        </button>
      ))}
      <label className="meta">
        from{" "}
        <input
          type="date"
          value={interval.from}
          onChange={(e) =>
            onChange((current) => ({ ...current, from: e.target.value }))
          }
        />
      </label>
      <label className="meta">
        to{" "}
        <input
          type="date"
          value={interval.to}
          onChange={(e) =>
            onChange((current) => ({ ...current, to: e.target.value }))
          }
        />
      </label>
    </div>
  );
}
