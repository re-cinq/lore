/**
 * no-sql-in-web-ui — the web UI is a presentation tier, not a database client.
 * Every read and write belongs to `lore-api` behind its OpenAPI contract
 * (`@/lib/api/client`), so a schema change breaks one deployable instead of two
 * and the UI never needs Postgres credentials. This flags SQL text — string or
 * template literal — in any file under `apps/web-ui/`.
 *
 * Detection is SQL-cased on purpose: the keywords must be uppercase, the way
 * every query in this repo is written. Matching case-insensitively would flag
 * ordinary UI copy ("Select a repo from the list"), and a rule that cries wolf
 * gets disabled rather than obeyed.
 *
 * Detect-only: the fix is an lore-api route plus a typed client call, which is
 * a design decision per query, not a codemod.
 */

const WEBUI_MARKER = "/apps/web-ui/";

// A bounded gap between paired keywords — unbounded `[\s\S]*?` would let a long
// prose blob with a stray SELECT and a much later FROM read as a query.
const GAP = "[\\s\\S]{0,500}?";

const SQL_PATTERNS = [
  new RegExp(`\\bSELECT\\b${GAP}\\bFROM\\b`),
  new RegExp(`\\bUPDATE\\b${GAP}\\bSET\\b`),
  /\bINSERT\s+INTO\b/,
  /\bDELETE\s+FROM\b/,
  /\bCREATE\s+(?:TABLE|INDEX|SCHEMA|VIEW|EXTENSION)\b/,
  /\bALTER\s+(?:TABLE|SCHEMA)\b/,
  /\bDROP\s+(?:TABLE|INDEX|SCHEMA|VIEW)\b/,
  /\bTRUNCATE\s+TABLE\b/,
];

function sqlIn(text) {
  return SQL_PATTERNS.some((pattern) => pattern.test(text));
}

/** The literal chunks of a template joined by spaces, so `FROM ${schema}.chunks`
 *  still reads as a query while an interpolated value never invents keywords. */
function templateText(node) {
  return node.quasis.map((quasi) => quasi.value.cooked ?? "").join(" ");
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "disallow SQL in apps/web-ui — the UI reads and writes through the lore-api HTTP contract, never through the database",
    },
    schema: [],
    messages: {
      sqlInWebUi:
        "SQL does not belong in web-ui. Move this query behind a lore-api route (apps/lore-api/src/api/routes/) and call it from the typed client (@/lib/api/client).",
    },
  },

  create(context) {
    if (!context.filename.replace(/\\/g, "/").includes(WEBUI_MARKER)) {
      return {};
    }

    function report(node) {
      context.report({ node, messageId: "sqlInWebUi" });
    }

    return {
      Literal(node) {
        if (typeof node.value === "string" && sqlIn(node.value)) {
          report(node);
        }
      },
      TemplateLiteral(node) {
        if (sqlIn(templateText(node))) {
          report(node);
        }
      },
    };
  },
};
