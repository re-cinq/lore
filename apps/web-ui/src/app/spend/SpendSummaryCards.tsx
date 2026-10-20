import type { ReactNode } from "react";
import styles from "./SpendView.module.css";
import type { SpendWindow } from "./SpendView";
import { usd, num, day, stamp } from "./spend-format";
import { StatTile, StatTiles } from "@/components/insights/StatTile";

interface StatCardProps {
  label: ReactNode;
  figure: string;
  estimate?: boolean;
  /** The headline tile, set on the primary color. */
  hero?: boolean;
  children?: ReactNode;
}

interface SummaryCardsProps {
  interval: SpendWindow["interval"];
  llm: SpendWindow["llm"];
  billed: SpendWindow["billed"];
  gcp: SpendWindow["gcp"];
  compute: SpendWindow["compute"];
}

/** The headline figures: what Lore computed from token counts, what each vendor actually billed, and what the pods cost. A billed card appears only once that vendor has synced. */
export function SummaryCards(props: SummaryCardsProps) {
  const { llm, billed, gcp, compute } = props;

  return (
    <StatTiles title="Headline figures">
      <LoreComputedCards llm={llm} />
      {billed.available && <AnthropicBilledCard billed={billed} />}
      <StatCard
        label="Kubernetes (estimated)"
        figure={usd(compute.est_total_usd)}
        estimate
      />
      {/* GCP invoice synced from BigQuery export; lags a day+, so estimate still needed */}
      {gcp.available && <GcpBilledCard gcp={gcp} />}
    </StatTiles>
  );
}

/** What Lore metered itself, over the chosen interval. Marked an estimate throughout: these are computed from token counts, and the vendor's invoice beside them is the authority. */
function LoreComputedCards({ llm }: Pick<SummaryCardsProps, "llm">) {
  return (
    <>
      <StatCard
        label="Lore-computed cost"
        figure={usd(llm.total_usd)}
        estimate
        hero
      >
        <Subnote>estimate from token counts</Subnote>
      </StatCard>
      <TokenCards llm={llm} />
    </>
  );
}

/** The counts the estimate is computed from. */
function TokenCards({ llm }: Pick<SummaryCardsProps, "llm">) {
  return (
    <>
      <StatCard label="API calls" figure={num(llm.calls)} />
      <StatCard label="Input tokens" figure={num(llm.input_tokens)} />
      <StatCard label="Output tokens" figure={num(llm.output_tokens)} />
      <StatCard label="Cache read tokens" figure={num(llm.cache_read_tokens)} />
      <StatCard
        label="Cache write tokens"
        figure={num(llm.cache_write_tokens)}
      />
    </>
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

/** One headline figure. `estimate` marks a number Lore computed rather than one a vendor billed, which is the distinction the whole page turns on. */
function StatCard(props: StatCardProps) {
  const { label, figure, estimate = false, hero = false, children } = props;

  return (
    <StatTile
      label={label}
      value={figure}
      hero={hero}
      valueClass={estimate && !hero ? styles.figureEstimate : undefined}
    >
      {children}
    </StatTile>
  );
}

function Subnote({ children }: { children: ReactNode }) {
  return <div className={`meta ${styles.subnote}`}>{children}</div>;
}
