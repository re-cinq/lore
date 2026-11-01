import type { AgentPresence } from "@/lib/agents-api";
import { presenceLabel } from "./presence-label";
import styles from "./PresenceDot.module.scss";

/** Whether the clusters hold the agent's latest version: green on every cluster, yellow not yet on every one, red on none. Its words are its tooltip and its name. */
export default function PresenceDot({ presence }: { presence: AgentPresence }) {
  const label = presenceLabel(presence);

  return (
    <span
      className={`${styles.dot} ${styles[presence.state]}`}
      data-testid="presence-dot"
      data-state={presence.state}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}
