import type { Pool } from "pg";
import type { SpendWindow } from "./spend-window-db.js";
import {
  TICKET_COSTS_SQL,
  REVIEW_PR_COSTS_SQL,
  REVIEW_BY_LINE_SQL,
  REVIEW_BY_MODEL_SQL,
  NODE_COSTS_SQL,
} from "./spend-window-units-sql.js";

const UNIT_COST_READS = [
  TICKET_COSTS_SQL,
  REVIEW_PR_COSTS_SQL,
  REVIEW_BY_LINE_SQL,
  REVIEW_BY_MODEL_SQL,
  NODE_COSTS_SQL,
];

/** What one ticket, one PR's reviews and one node visit cost over the window — five independent reads, run together. */
export async function readUnitCosts(pool: Pool, win: SpendWindow) {
  const params = [win.fromTs, win.toTs];
  const [tickets, perPr, byLine, byModel, nodes] = await Promise.all(
    UNIT_COST_READS.map((sql) => pool.query(sql, params)),
  );

  return {
    tickets: tickets.rows[0],
    reviews: {
      per_pr: perPr.rows[0],
      by_line: byLine.rows,
      by_model: byModel.rows,
    },
    nodes: nodes.rows,
  };
}
