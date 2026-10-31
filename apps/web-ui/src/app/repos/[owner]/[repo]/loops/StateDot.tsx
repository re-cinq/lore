import styles from "./StateDot.module.scss";

interface StateDotProps {
  enabled: boolean;
  /** Switched on but held by a pause: amber instead of green. */
  paused?: boolean;
}

/** A loop's state as a colour: green on, amber paused, red off. Decorative; the text beside it says the same. */
export default function StateDot({ enabled, paused = false }: StateDotProps) {
  const state = stateOf({ enabled, paused });

  return (
    <span
      className={`${styles.dot} ${styles[state]}`}
      data-testid="state-dot"
      data-enabled={enabled}
      data-state={state}
      aria-hidden="true"
    />
  );
}

function stateOf({
  enabled,
  paused,
}: Required<StateDotProps>): "on" | "off" | "paused" {
  if (!enabled) {
    return "off";
  }

  return paused ? "paused" : "on";
}
