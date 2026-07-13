import { formatRelativeTime } from "@/lib/assembly-lines";

export function TimeAgo({
  date,
  nowMs = Date.now(),
  inline = false,
}: {
  date: string | Date;
  nowMs?: number;
  /** Render absolute + relative on one line, for use mid-sentence. */
  inline?: boolean;
}) {
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return <time>{String(date)}</time>;
  const iso = parsed.toISOString();
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {parsed.toLocaleString()}
      {inline ? " " : <br />}
      <span className="meta" style={{ fontSize: "0.85em" }}>
        ({formatRelativeTime(iso, nowMs)})
      </span>
    </time>
  );
}
