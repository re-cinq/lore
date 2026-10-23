import Link from "next/link";
import type { LoopKey, RepoLoop } from "@/lib/api/loops";
import StateDot from "./StateDot";
import styles from "./LoopPicker.module.scss";

interface LoopPickerProps {
  loops: readonly RepoLoop[];
  selected: LoopKey;
  /** The repo's `/loops` path, which each pill links to with its own `?loop=`. */
  base: string;
}

/** One pill per loop, each with its switch state, so the whole repository's automation posture reads at a glance; the selected one is the page below. */
export default function LoopPicker({ loops, selected, base }: LoopPickerProps) {
  return (
    <nav aria-label="Loops" className={styles.row}>
      {loops.map((loop) => (
        <Link
          key={loop.key}
          href={`${base}?loop=${loop.key}`}
          aria-current={loop.key === selected ? "page" : undefined}
          className={styles.pill}
        >
          <StateDot enabled={loop.enabled} />
          {loop.label}
        </Link>
      ))}
    </nav>
  );
}
