import type { SpendWindow } from "./SpendView";
import { usd, num } from "./spend-format";
import { CostTable } from "./CostTable";

type UnitCostsData = SpendWindow["unit_costs"];
type RankedUnits = UnitCostsData["tickets"];
type CostUnit = RankedUnits["most"][number];

/** How a ranked block names its units: the summary's count column, the two ranked tables' titles, and their empty text. */
interface UnitNames {
  countColumn: string;
  summaryTitle: string;
  most: string;
  least: string;
  unitColumn: string;
  empty: string;
}

const TICKETS: UnitNames = {
  countColumn: "Tickets",
  summaryTitle: "Cost per Ticket",
  most: "Most Expensive Tickets",
  least: "Cheapest Tickets",
  unitColumn: "Ticket",
  empty: "No ticket spend in this window",
};

const PRS: UnitNames = {
  countColumn: "PRs",
  summaryTitle: "Cost per PR Review",
  most: "Most Expensive PRs",
  least: "Cheapest PRs",
  unitColumn: "Pull request",
  empty: "No review spend in this window",
};

/** What one unit of work costs over the window: a ticket, a PR's reviews, a node visit. */
export function UnitCosts({ unitCosts }: { unitCosts: UnitCostsData }) {
  return (
    <>
      <RankedUnitTables ranked={unitCosts.tickets} names={TICKETS} />
      <ReviewCosts reviews={unitCosts.reviews} />
      <NodeCosts nodes={unitCosts.nodes} />
    </>
  );
}

/** The summary row, then the five dearest and five cheapest units — the same three tables for tickets and PRs. */
function RankedUnitTables({ ranked, names }: RankedProps) {
  return (
    <>
      <SummaryTable ranked={ranked} names={names} />
      <UnitTable title={names.most} units={ranked.most} names={names} />
      <UnitTable title={names.least} units={ranked.least} names={names} />
    </>
  );
}

interface RankedProps {
  ranked: RankedUnits;
  names: UnitNames;
}

function SummaryTable({ ranked, names }: RankedProps) {
  return (
    <CostTable
      title={names.summaryTitle}
      columns={[names.countColumn, "Total", "Average", "Median"]}
      rows={[ranked]}
      rowKey={() => names.summaryTitle}
      cells={(r) => [
        num(r.count),
        usd(r.total_usd),
        usd(r.avg_usd),
        usd(r.median_usd),
      ]}
    />
  );
}

interface UnitTableProps {
  title: string;
  units: readonly CostUnit[];
  names: UnitNames;
}

function UnitTable({ title, units, names }: UnitTableProps) {
  return (
    <CostTable
      title={title}
      columns={[names.unitColumn, "Runs", "Cost"]}
      rows={units}
      rowKey={(u) => u.url ?? u.label}
      empty={names.empty}
      cells={unitCells}
    />
  );
}

function unitCells(unit: CostUnit) {
  return [
    <UnitLabel key="unit" unit={unit} />,
    num(unit.runs),
    usd(unit.cost_usd),
  ];
}

/** A unit links to its Issue or pull request; one known only by its description has nowhere to link. */
function UnitLabel({ unit }: { unit: CostUnit }) {
  if (!unit.url) {
    return <>{unit.label}</>;
  }

  return (
    <a href={unit.url} target="_blank" rel="noreferrer">
      {unit.label}
    </a>
  );
}

type Reviews = UnitCostsData["reviews"];

/** A PR's review cost, then what each review line costs per run and which models it went to. */
function ReviewCosts({ reviews }: { reviews: Reviews }) {
  return (
    <>
      <RankedUnitTables ranked={reviews.per_pr} names={PRS} />
      <ReviewLineTable byLine={reviews.by_line} />
      <CostTable
        title="Review Cost by Model"
        columns={["Model", "Calls", "Cost"]}
        rows={reviews.by_model}
        rowKey={(r) => r.model}
        empty={PRS.empty}
        cells={(r) => [r.model, num(r.calls), usd(r.cost_usd)]}
      />
    </>
  );
}

function ReviewLineTable({ byLine }: { byLine: Reviews["by_line"] }) {
  return (
    <CostTable
      title="Review Cost by Line"
      columns={["Assembly line", "Runs", "Total", "Cost / run"]}
      rows={byLine}
      rowKey={(r) => r.blueprint}
      empty={PRS.empty}
      cells={(r) => [
        r.blueprint,
        num(r.runs),
        usd(r.total_usd),
        usd(r.avg_usd),
      ]}
    />
  );
}

type NodeCost = UnitCostsData["nodes"][number];

const NODE_COLUMNS = [
  "Assembly line",
  "Node",
  "Visits",
  "Total",
  "Cost / visit",
  "Models",
];

function NodeCosts({ nodes }: { nodes: readonly NodeCost[] }) {
  return (
    <CostTable
      title="Cost per Node"
      columns={NODE_COLUMNS}
      rows={nodes}
      rowKey={(n) => `${n.blueprint}/${n.node_id}`}
      empty="No node-attributed spend in this window"
      cells={nodeCells}
    />
  );
}

function nodeCells(node: NodeCost) {
  return [
    node.blueprint,
    node.node_id,
    num(node.visits),
    usd(node.total_usd),
    usd(node.per_visit_usd),
    node.models.join(", "),
  ];
}
