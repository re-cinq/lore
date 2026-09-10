"use client";

// Container: owns interval, fetches /api/spend-window, hands response to pure SpendView (DDAU)
import { useEffect, useState } from "react";
import {
  presetInterval,
  spendWindowQuery,
  type SpendPreset,
} from "./spend-window-presets";
import SpendView, { type SpendWindow } from "./SpendView";
import styles from "./SpendView.module.css";

export default function SpendWindowPanel() {
  const [interval, setInterval] = useState(() => presetInterval("7d"));
  const { spend, error } = useSpendWindow(interval);

  return (
    <section aria-label="Spend for the selected interval">
      <IntervalPicker interval={interval} onChange={setInterval} />
      {error !== null && <p className="meta">{error}</p>}
      {spend !== null && <SpendView spend={spend} />}
    </section>
  );
}

/** One fetch per interval, with a cancelled guard so a slow response for a previous interval cannot land over a newer one. */
function useSpendWindow(interval: { from: string; to: string }) {
  const [spend, setSpend] = useState<SpendWindow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void fetchSpendWindow(interval).then((outcome) => {
      if (cancelled) {
        return;
      }
      setSpend(outcome.spend);
      setError(outcome.error);
    });

    return () => {
      cancelled = true;
    };
  }, [interval]);

  return { spend, error };
}

/** One interval's spend, or the reason there is none. Returns the outcome rather than setting state so the caller can drop a late response: the guard belongs where the interval is known to have changed. */
async function fetchSpendWindow(interval: { from: string; to: string }) {
  try {
    const res = await fetch(`/api/spend-window?${spendWindowQuery(interval)}`, {
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json()) as SpendWindow & { error?: string };

    return res.ok
      ? { spend: body, error: null }
      : { spend: null, error: spendWindowError(body, res.status) };
  } catch (err) {
    return { spend: null, error: describeFetchError(err) };
  }
}

function describeFetchError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function spendWindowError(body: { error?: string }, status: number): string {
  return body.error ?? `spend-window returned ${status}`;
}

interface Interval {
  from: string;
  to: string;
}

type IntervalChange = (update: (current: Interval) => Interval) => void;

interface IntervalPickerProps {
  interval: Interval;
  onChange: IntervalChange;
}

interface DateFieldProps extends IntervalPickerProps {
  label: string;
  field: keyof Interval;
}

function IntervalPicker({ interval, onChange }: IntervalPickerProps) {
  return (
    <div className={styles.presetRow}>
      <PresetButtons onChange={onChange} />
      <DateField
        label="from"
        field="from"
        interval={interval}
        onChange={onChange}
      />
      <DateField
        label="to"
        field="to"
        interval={interval}
        onChange={onChange}
      />
    </div>
  );
}

const PRESETS: Array<{ key: SpendPreset; label: string }> = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "mtd", label: "Month to date" },
];

/** The common ranges, as one click each. A preset REPLACES the interval rather than editing an end of it, so picking one never leaves a stale `from` paired with a fresh `to`. */
function PresetButtons({ onChange }: { onChange: IntervalChange }) {
  return (
    <>
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
    </>
  );
}

/** One end of the range. Edits the named field and leaves the other alone, so moving `from` past `to` is the reader's business rather than something this control silently corrects. */
function DateField({ label, field, interval, onChange }: DateFieldProps) {
  return (
    <label className="meta">
      {label}{" "}
      <input
        type="date"
        value={interval[field]}
        onChange={(e) =>
          onChange((current) => ({ ...current, [field]: e.target.value }))
        }
      />
    </label>
  );
}
