import Link from "next/link";
import type { ReactNode } from "react";
import type { RepoLoop } from "@/lib/api/loops";
import LinkPending from "./LinkPending";
import StateDot from "./StateDot";
import styles from "./LoopPicker.module.scss";

/** The pill that shows every loop of the repository at once. */
export const ALL_LOOPS = "all";

interface LoopPickerProps {
  loops: readonly RepoLoop[];
  /** A loop's key, or `all`. */
  selected: string;
  /** The repo's `/loops` path, which each pill links to with its own `?loop=`. */
  base: string;
}

/** All, then one pill per loop with its switch state, so the whole repository's automation posture reads at a glance; the selected one is the page below. */
export default function LoopPicker({ loops, selected, base }: LoopPickerProps) {
  return (
    <nav aria-label="Loops" className={styles.row}>
      <Pill href={`${base}?loop=${ALL_LOOPS}`} current={selected === ALL_LOOPS}>
        All
      </Pill>
      {loops.map((loop) => (
        <Pill
          key={loop.key}
          href={`${base}?loop=${loop.key}`}
          current={loop.key === selected}
        >
          <StateDot enabled={loop.enabled} paused={loop.paused !== null} />
          {loop.label}
        </Pill>
      ))}
    </nav>
  );
}

interface PillProps {
  href: string;
  current: boolean;
  children: ReactNode;
}

/** Not prefetched, so a click always shows its pending mark: the loops' pages read GitHub and the floor, and a prefetch would hide the wait without shortening it. */
function Pill({ href, current, children }: PillProps) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={current ? "page" : undefined}
      className={styles.pill}
    >
      {children}
      <LinkPending />
    </Link>
  );
}
