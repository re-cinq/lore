import {
  StatTile,
  StatTiles,
  type StatDot,
} from "@/components/insights/StatTile";
import { InsightsCard } from "@/components/insights/InsightsCard";
import { ColumnChart } from "@/components/insights/ColumnChart";
import type { DailyUsage, TaskSummary } from "./AnalyticsView";

const EMPTY_TASK_SUMMARY: TaskSummary = {
  total: 0,
  succeeded: 0,
  failed: 0,
  active: 0,
};

const OUTCOMES: Array<[string, keyof TaskSummary, StatDot]> = [
  ["Succeeded", "succeeded", "ok"],
  ["Failed", "failed", "bad"],
  ["Active", "active", "run"],
];

/** The task count, headlined, then how those tasks ended. A null summary reads as all zeros, the same as a fresh install. */
export function TaskSummaryTiles({ summary }: { summary: TaskSummary | null }) {
  const s = summary ?? EMPTY_TASK_SUMMARY;

  return (
    <StatTiles title="Task Summary">
      <StatTile hero label="Tasks" value={Number(s.total).toLocaleString()} />
      {OUTCOMES.map(([label, field, dot]) => (
        <StatTile
          key={field}
          label={label}
          dot={dot}
          value={Number(s[field]).toLocaleString()}
        />
      ))}
    </StatTiles>
  );
}

/** LLM calls per day over the window the API reads, oldest on the left. */
export function DailyCallsChart({ dailyUsage }: { dailyUsage: DailyUsage[] }) {
  const days = [...dailyUsage].sort((a, b) => a.day.localeCompare(b.day));
  const total = days.reduce((sum, d) => sum + Number(d.calls), 0);

  return (
    <InsightsCard
      title="LLM calls per day"
      caption={`Last 14 days · ${total.toLocaleString()} calls`}
    >
      {days.length === 0 ? (
        <p className="meta">No LLM calls in the last 14 days.</p>
      ) : (
        <DailyColumns days={days} />
      )}
    </InsightsCard>
  );
}

function DailyColumns({ days }: { days: DailyUsage[] }) {
  const label = (d: DailyUsage) => new Date(d.day).toLocaleDateString();

  return (
    <ColumnChart
      label={`LLM calls per day, ${label(days[0])} to ${label(days[days.length - 1])}`}
      startLabel={label(days[0])}
      endLabel={label(days[days.length - 1])}
      points={days.map((d) => ({
        key: d.day,
        value: Number(d.calls),
        label: `${label(d)}: ${Number(d.calls).toLocaleString()} calls`,
      }))}
    />
  );
}
