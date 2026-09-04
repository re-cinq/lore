import type { ReactNode } from "react";
import styles from "./SpendView.module.css";
import type { SpendWindow } from "./SpendView";
import { usd, num, day, stamp } from "./spend-format";

/** One headline figure. `estimate` marks a number Lore computed rather than one a vendor billed, which is the distinction the whole page turns on. */
function StatCard({
  label,
  figure,
  estimate = false,
  children,
}: {
  label: ReactNode;
  figure: string;
  estimate?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`spec-card ${styles.card}`}>
      <div className="meta">{label}</div>
      <div className={estimate ? styles.figureInfo : styles.figure}>
        {figure}
      </div>
      {children}
    </div>
  );
}

function Subnote({ children }: { children: ReactNode }) {
  return <div className={`meta ${styles.subnote}`}>{children}</div>;
}

/** The headline figures: what Lore computed from token counts, what each vendor actually billed, and what the pods cost. A billed card appears only once that vendor has synced. */
export function SummaryCards({
  interval,
  llm,
  billed,
  gcp,
  compute,
}: {
  interval: SpendWindow["interval"];
  llm: SpendWindow["llm"];
  billed: SpendWindow["billed"];
  gcp: SpendWindow["gcp"];
  compute: SpendWindow["compute"];
}) {
  return (
    <div className={styles.cards}>
      <StatCard
        label={`Lore-computed cost ${day(interval.from)} → ${day(interval.to)}`}
        figure={usd(llm.total_usd)}
        estimate
      >
        <Subnote>estimate from token counts</Subnote>
      </StatCard>
      <StatCard label="API calls" figure={num(llm.calls)} />
      <StatCard label="Input tokens" figure={num(llm.input_tokens)} />
      <StatCard label="Output tokens" figure={num(llm.output_tokens)} />
      {billed.available && <AnthropicBilledCard billed={billed} />}
      <StatCard
        label="Kubernetes (estimated)"
        figure={usd(compute.est_total_usd)}
        estimate
      >
        <Subnote>+ {usd(compute.live_usd_per_hour)}/h burning now</Subnote>
      </StatCard>
      {/* GCP invoice synced from BigQuery export; lags a day+, so estimate still needed */}
      {gcp.available && <GcpBilledCard gcp={gcp} />}
    </div>
  );
}

/** The Anthropic invoice, plus what Lore metered after the last billed day — the report lags, so the unbilled remainder is surfaced separately and labelled rather than folded in. */
function AnthropicBilledCard({ billed }: { billed: SpendWindow["billed"] }) {
  return (
    <StatCard label="Billed cost (Anthropic)" figure={usd(billed.total_usd)}>
      <Subnote>as of {stamp(billed.as_of as string)}</Subnote>
      {billed.unbilled_usd > 0 && (
        <Subnote>
          {billed.billed_through
            ? `billed through ${day(billed.billed_through)}`
            : "not yet billed"}{" "}
          — + {usd(billed.unbilled_usd)}{" "}
          {billed.unbilled_days === 1
            ? "today"
            : `over ${num(billed.unbilled_days)} days since`}{" "}
          (Lore-computed)
        </Subnote>
      )}
    </StatCard>
  );
}

function GcpBilledCard({ gcp }: { gcp: SpendWindow["gcp"] }) {
  return (
    <StatCard label="Google Cloud (billed)" figure={usd(gcp.total_usd)}>
      <Subnote>
        {gcp.billed_through
          ? `billed through ${day(gcp.billed_through)}`
          : "no closed day in this interval yet"}{" "}
        — net of credits
      </Subnote>
    </StatCard>
  );
}
