import type { Pool } from "pg";
import {
  githubHost,
  githubHostPattern,
  githubUrls,
} from "@re-cinq/lore-shared/github-host.js";
import type { SpendWindow } from "./spend-window-db.js";
import {
  TICKET_COSTS_SQL,
  REVIEW_PR_COSTS_SQL,
  REVIEW_BY_LINE_SQL,
  REVIEW_BY_MODEL_SQL,
  NODE_COSTS_SQL,
} from "./spend-window-units-sql.js";

interface UnitCostRead {
  sql: string;
  params: string[];
}

/** The five reads, each bound with exactly the values its SQL names: the pull request read builds links on the GitHub web address ($3), and the ticket read also matches issue urls against that address's regex source ($4). */
export function unitCostReads(
  win: SpendWindow,
  host: string = githubHost(),
): UnitCostRead[] {
  const windowParams = [win.fromTs, win.toTs];
  const linkParams = [...windowParams, githubUrls(host).web];
  const ticketParams = [...linkParams, `https://${githubHostPattern(host)}`];

  return [
    { sql: TICKET_COSTS_SQL, params: ticketParams },
    { sql: REVIEW_PR_COSTS_SQL, params: linkParams },
    { sql: REVIEW_BY_LINE_SQL, params: windowParams },
    { sql: REVIEW_BY_MODEL_SQL, params: windowParams },
    { sql: NODE_COSTS_SQL, params: windowParams },
  ];
}

/** What one ticket, one PR's reviews and one node visit cost over the window — five independent reads, run together. */
export async function readUnitCosts(pool: Pool, win: SpendWindow) {
  const [tickets, perPr, byLine, byModel, nodes] = await Promise.all(
    unitCostReads(win).map(({ sql, params }) => pool.query(sql, params)),
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
