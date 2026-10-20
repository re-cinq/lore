import type { StatusTone } from "./StatusPill";
import styles from "./FilterChips.module.css";

/** A chip's colour: one of the status tones, or plain for "all". */
export type ChipTone = StatusTone | "neutral";

export interface FilterChip {
  label: string;
  href: string;
  active: boolean;
  /** How many rows the chip narrows to, when the page knows. */
  count?: number;
  tone?: ChipTone;
}

interface FilterChipsProps {
  /** Names the row for assistive tech, e.g. "Entity types". */
  label: string;
  chips: FilterChip[];
}

/** A row of filter links, each a tinted pill; the active one is filled. */
export default function FilterChips({ label, chips }: FilterChipsProps) {
  return (
    <nav aria-label={label} className={styles.row}>
      {chips.map((chip) => (
        <Chip key={chip.href} chip={chip} />
      ))}
    </nav>
  );
}

function Chip({ chip }: { chip: FilterChip }) {
  const tone = chip.active ? styles.active : styles[chip.tone ?? "neutral"];

  return (
    <a
      href={chip.href}
      aria-current={chip.active ? "page" : undefined}
      className={`${styles.chip} ${tone}`}
    >
      {chip.label}
      {chip.count === undefined ? null : (
        <>
          {" "}
          <span className={styles.count}>{chip.count}</span>
        </>
      )}
    </a>
  );
}
