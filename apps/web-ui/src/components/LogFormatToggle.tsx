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
  onChange: (raw: boolean) => void;
}

/** Raw/Formatted segmented control for the log viewers. Stateless (DDAU). */
export default function LogFormatToggle({
  raw,
  onChange,
}: LogFormatToggleProps) {
  return (
    <span className={styles.group}>
      <ToggleOption
        label="Formatted"
        pressed={!raw}
        onSelect={() => onChange(false)}
      />
      <ToggleOption label="Raw" pressed={raw} onSelect={() => onChange(true)} />
    </span>
  );
}
