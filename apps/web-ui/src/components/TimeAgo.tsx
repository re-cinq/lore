import styles from "./TimeAgo.module.scss";
import { formatRelativeTime } from "@/lib/assembly-run-presenter";

interface TimeAgoProps {
  date: string | Date;
  nowMs?: number;
  /** Render absolute + relative on one line, for use mid-sentence. */
  inline?: boolean;
}

export function TimeAgo({
  date,
  // eslint-disable-next-line react-hooks/purity -- rendered once per request by server components; tests inject nowMs
  nowMs = Date.now(),
  inline = false,
}: TimeAgoProps) {
  const parsed = date instanceof Date ? date : new Date(date);

  if (Number.isNaN(parsed.getTime())) {
    return <time>{String(date)}</time>;
  }
  const iso = parsed.toISOString();

  return (
    <time dateTime={iso} suppressHydrationWarning>
      {parsed.toLocaleString()}
      {inline ? " " : <br />}
      <RelativeTime iso={iso} nowMs={nowMs} />
    </time>
  );
}

/** The "(3 minutes ago)" half, muted beside the absolute timestamp. */
function RelativeTime({ iso, nowMs }: { iso: string; nowMs: number }) {
  return (
    <span className={`meta ${styles.relative}`}>
      ({formatRelativeTime(iso, nowMs)})
    </span>
  );
}
