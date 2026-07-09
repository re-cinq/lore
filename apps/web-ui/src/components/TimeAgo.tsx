import { formatRelativeTime } from '@/lib/assembly-lines';

export function TimeAgo({ date, nowMs = Date.now() }: { date: string | Date; nowMs?: number }) {
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return <time>{String(date)}</time>;
  const iso = parsed.toISOString();
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {parsed.toLocaleString()} <span className="meta">({formatRelativeTime(iso, nowMs)})</span>
    </time>
  );
}
