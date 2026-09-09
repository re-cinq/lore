import styles from "./LogFormatToggle.module.css";

interface ToggleOptionProps {
  label: string;
  pressed: boolean;
  onSelect: () => void;
}

/** One half of the control. `aria-pressed` rather than a selected class, so the active format is announced and not only styled. */
function ToggleOption({ label, pressed, onSelect }: ToggleOptionProps) {
  return (
    <button
      type="button"
      className={styles.option}
      aria-pressed={pressed}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}

interface LogFormatToggleProps {
  raw: boolean;
  onFormatted: () => void;
  onRaw: () => void;
}

/** Raw/Formatted segmented control for the log viewers. Stateless (DDAU). */
export default function LogFormatToggle({
  raw,
  onFormatted,
  onRaw,
}: LogFormatToggleProps) {
  return (
    <span className={styles.group}>
      <ToggleOption label="Formatted" pressed={!raw} onSelect={onFormatted} />
      <ToggleOption label="Raw" pressed={raw} onSelect={onRaw} />
    </span>
  );
}

interface LogFormatToggleRowProps {
  className: string;
  showRaw: boolean;
  setShowRaw: (raw: boolean) => void;
}

/** The toggle on its own row, wired to a boolean setter — the shape both log viewers need; each passes the row class from its own stylesheet, which is all they disagree about. */
export function LogFormatToggleRow({
  className,
  showRaw,
  setShowRaw,
}: LogFormatToggleRowProps) {
  return (
    <div className={className}>
      <LogFormatToggle
        raw={showRaw}
        onFormatted={() => setShowRaw(false)}
        onRaw={() => setShowRaw(true)}
      />
    </div>
  );
}
