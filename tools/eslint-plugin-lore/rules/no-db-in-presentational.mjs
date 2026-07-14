/**
 * no-db-in-presentational — web-ui follows container/presentational with
 * data-down/actions-up (DDAU): route containers (`page.tsx`) and client
 * containers (`*Panel.tsx`) fetch via `@/lib/db` and pass the result down as
 * props; presentational components (`*View`/`*Card`/`*Table`/`*Section`/
 * `*Badge`/`*Row`/`*Timeline`) receive data as props and never fetch it.
 * Flags static imports, dynamic `import()`, and `require()` of the data layer
 * inside a presentational file under `apps/web-ui/src/`.
 *
 * Detect-only: the fix is moving the query up to the right container and
 * threading a prop — which container and what prop shape needs a human.
 *
 * HTTP `fetch("/api/...")` is deliberately allowed: the live-polling leaves
 * (TaskLogs, Timeline, PRStatusCard, InfiniteEvents) never touch the pg pool.
 */

const WEBUI_MARKER = "/apps/web-ui/src/";
const PRESENTATIONAL = /(?:View|Card|Table|Section|Badge|Row|Timeline)\.tsx$/;
const DATA_LAYER = "@/lib/db";

function presentationalName(filename) {
  const path = filename.replace(/\\/g, "/");
  if (!path.includes(WEBUI_MARKER)) return null;
  const base = path.slice(path.lastIndexOf("/") + 1);
  if (base.includes(".test.")) return null;
  if (!PRESENTATIONAL.test(base)) return null;
  return base.slice(0, -".tsx".length);
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "disallow importing the data layer (@/lib/db) in presentational web-ui components — fetch in the route container and pass props down (DDAU)",
    },
    schema: [],
    messages: {
      dbInPresentational:
        "Presentational component '{{name}}' must not import the data layer ('{{source}}'). Fetch in the route container (page.tsx) and pass the result down as props (data down, actions up).",
    },
  },

  create(context) {
    const name = presentationalName(context.filename);
    if (!name) {
      return {};
    }

    function reportIfDataLayer(node, value) {
      if (value !== DATA_LAYER) return;
      context.report({
        node,
        messageId: "dbInPresentational",
        data: { name, source: value },
      });
    }

    return {
      ImportDeclaration(node) {
        reportIfDataLayer(node, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === "Literal") {
          reportIfDataLayer(node, node.source.value);
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments.length === 1 &&
          node.arguments[0].type === "Literal"
        ) {
          reportIfDataLayer(node, node.arguments[0].value);
        }
      },
    };
  },
};
