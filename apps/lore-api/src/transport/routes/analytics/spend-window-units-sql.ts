// What a unit of work costs over the window (#2116): a ticket, a PR's reviews, one node visit. Every read is windowed on llm_calls.created_at ($1, $2) and aggregated in SQL, median included.

/** Count, total, mean and median over a `units(label, url, runs, cost_usd)` CTE, plus its five dearest and five cheapest units. */
function rankedUnitsSql(unitsCte: string): string {
  return `WITH ${unitsCte}
SELECT count(*)::int AS count,
       COALESCE(sum(cost_usd), 0)::float8 AS total_usd,
       COALESCE(avg(cost_usd), 0)::float8 AS avg_usd,
       COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY cost_usd), 0)::float8 AS median_usd,
       ${rankedSlice("DESC")} AS most,
       ${rankedSlice("ASC")} AS least
  FROM units`;
}

function rankedSlice(direction: "ASC" | "DESC"): string {
  return `COALESCE((SELECT json_agg(u ORDER BY u.cost_usd ${direction}, u.label)
                FROM (SELECT label, url, runs, cost_usd FROM units
                       ORDER BY cost_usd ${direction}, label LIMIT 5) u), '[]'::json)`;
}

// A ticket is its Issue: the task's issue_url, else the issue-<n> the loop branch names (the same url, so both merge), else the description older runs carry. A call reaches its run by assembly_line_id, or its task alone when it was never attributed to a run.
export const TICKET_COSTS_SQL = rankedUnitsSql(`ticket_calls AS (
  SELECT l.cost_usd, ar.id AS run_id,
         COALESCE(t.issue_url, 'https://github.com/' || COALESCE(ar.repo, t.target_repo)
                  || '/issues/' || substring(ar.branch FROM 'issue-([0-9]+)$')) AS url,
         COALESCE(ar.repo, t.target_repo) AS repo,
         COALESCE(t.description, 'run ' || ar.id) AS title
    FROM pipeline.llm_calls l
    LEFT JOIN pipeline.assembly_runs ar ON ar.id = l.assembly_line_id
    LEFT JOIN pipeline.tasks t ON t.id = COALESCE(ar.task_id, l.task_id)
   WHERE l.created_at >= $1 AND l.created_at < $2
     AND (ar.blueprint_name = 'implementation-loop'
          OR (ar.id IS NULL AND t.task_type = 'implementation-loop'))
), units AS (
  SELECT COALESCE(regexp_replace(max(url), '^https://github\\.com/([^/]+/[^/]+)/issues/([0-9]+)$', '\\1#\\2'),
                  left(max(title), 80)) AS label,
         max(url) AS url, count(DISTINCT run_id)::int AS runs, sum(cost_usd)::float8 AS cost_usd
    FROM ticket_calls
   GROUP BY COALESCE(url, repo || ' ' || title)
)`);

const REVIEW_LINES = `('code-review', 'code-review-recheck', 'code-review-reply')`;

// A PR's review cost is every review-family run keyed to it — the first review, each recheck, each reply.
export const REVIEW_PR_COSTS_SQL = rankedUnitsSql(`units AS (
  SELECT ar.repo || '#' || (ar.args->>'pr_number') AS label,
         'https://github.com/' || ar.repo || '/pull/' || (ar.args->>'pr_number') AS url,
         count(DISTINCT ar.id)::int AS runs, sum(l.cost_usd)::float8 AS cost_usd
    FROM pipeline.llm_calls l
    JOIN pipeline.assembly_runs ar ON ar.id = l.assembly_line_id
   WHERE l.created_at >= $1 AND l.created_at < $2
     AND ar.blueprint_name IN ${REVIEW_LINES}
     AND ar.args->>'pr_number' IS NOT NULL
   GROUP BY ar.repo, ar.args->>'pr_number'
)`);

export const REVIEW_BY_LINE_SQL = `SELECT ar.blueprint_name AS blueprint, count(DISTINCT ar.id)::int AS runs,
            sum(l.cost_usd)::float8 AS total_usd,
            (sum(l.cost_usd) / count(DISTINCT ar.id))::float8 AS avg_usd
       FROM pipeline.llm_calls l
       JOIN pipeline.assembly_runs ar ON ar.id = l.assembly_line_id
      WHERE l.created_at >= $1 AND l.created_at < $2
        AND ar.blueprint_name IN ${REVIEW_LINES}
      GROUP BY 1 ORDER BY 1`;

export const REVIEW_BY_MODEL_SQL = `SELECT l.model, count(*)::int AS calls, sum(l.cost_usd)::float8 AS cost_usd
       FROM pipeline.llm_calls l
       JOIN pipeline.assembly_runs ar ON ar.id = l.assembly_line_id
      WHERE l.created_at >= $1 AND l.created_at < $2
        AND ar.blueprint_name IN ${REVIEW_LINES}
      GROUP BY 1 ORDER BY 3 DESC`;

// A visit is one station_runs row; a call reaches it through llm_calls.station_run_id, so calls recorded before that column existed are not counted here.
export const NODE_COSTS_SQL = `SELECT ar.blueprint_name AS blueprint, sr.node_id,
            count(DISTINCT sr.id)::int AS visits,
            sum(l.cost_usd)::float8 AS total_usd,
            (sum(l.cost_usd) / count(DISTINCT sr.id))::float8 AS per_visit_usd,
            array_agg(DISTINCT l.model ORDER BY l.model) AS models
       FROM pipeline.llm_calls l
       JOIN pipeline.station_runs sr ON sr.station_run_id = l.station_run_id
       JOIN pipeline.assembly_runs ar ON ar.id = sr.assembly_run_id
      WHERE l.created_at >= $1 AND l.created_at < $2
      GROUP BY 1, 2 ORDER BY 1, 4 DESC`;
