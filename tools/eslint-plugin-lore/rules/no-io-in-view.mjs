/**
 * no-io-in-view — the "data down" half of DDAU (data-down/actions-up). A view
 * (presentational) component presents data it receives as props; it must not
 * reach the outside world. Containers (`page.tsx`, `layout.tsx`, `*Panel.tsx`,
 * `actions.ts`, api routes) own the IO and pass the result down. This flags,
 * inside a view-suffixed file under `apps/web-ui/src/`:
 *   - imports of the data layer (`@/lib/db`, `@/lib/github`) or a server-action
 *     module (specifier ending in `actions`) — static, dynamic `import()`, `require()`
 *   - network globals: `fetch`, `new WebSocket/EventSource/XMLHttpRequest`,
 *     `navigator.sendBeacon`
 *
 * A denylist of the known exterior-world channels, not an allowlist: views
 * legitimately import components, types, CSS modules, and pure helpers, so
 * banning specific IO channels is what keeps false positives out.
 *
 * Detect-only: the fix is lifting the IO into the right container and threading
 * a prop — which container + what prop shape needs a human, not a codemod.
 */

const WEBUI_MARKER = "/apps/web-ui/src/";
const VIEW_SUFFIX = /(?:View|Card|Table|Section|Badge|Row)\.tsx$/;
const DATA_MODULES = new Set(["@/lib/db", "@/lib/github"]);
const XHR_CONSTRUCTORS = new Set([
  "WebSocket",
  "EventSource",
  "XMLHttpRequest",
]);
const GLOBAL_HOSTS = new Set(["window", "globalThis", "self"]);

function bannedSource(value) {
  if (typeof value !== "string") {
    return null;
  }

  if (DATA_MODULES.has(value)) {
    return value;
  }

  // Server-action modules — the final path segment is `actions`. Actions flow
  // down as props; a view importing them is doing the container's job.
  if (/(?:^|\/)actions$/.test(value)) {
    return value;
  }

  return null;
}

function viewName(filename) {
  const path = filename.replace(/\\/g, "/");
  if (!path.includes(WEBUI_MARKER)) {
    return null;
  }

  const base = path.slice(path.lastIndexOf("/") + 1);
  if (base.includes(".test.")) {
    return null;
  }

  if (!VIEW_SUFFIX.test(base)) {
    return null;
  }

  return base.slice(0, -".tsx".length);
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "disallow reaching the outside world (data layer, server actions, network globals) in presentational web-ui components — fetch in the container and pass props down (DDAU)",
    },
    schema: [],
    messages: {
      ioImportInView:
        "Presentational component '{{name}}' must not reach the outside world — it imports '{{source}}'. Fetch in the container (page.tsx / *Panel.tsx) and pass the result down as props (data down, actions up).",
      networkCallInView:
        "Presentational component '{{name}}' must not reach the outside world — it calls '{{api}}'. Move the network call into a container and pass the result down as props (data down, actions up).",
    },
  },

  create(context) {
    const name = viewName(context.filename);
    if (!name) {
      return {};
    }

    function reportImport(node, value) {
      const source = bannedSource(value);
      if (source) {
        context.report({
          node,
          messageId: "ioImportInView",
          data: { name, source },
        });
      }
    }

    function reportNetwork(node, api) {
      context.report({
        node,
        messageId: "networkCallInView",
        data: { name, api },
      });
    }

    return {
      ImportDeclaration(node) {
        reportImport(node, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === "Literal") {
          reportImport(node, node.source.value);
        }
      },
      NewExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          XHR_CONSTRUCTORS.has(node.callee.name)
        ) {
          reportNetwork(node, `new ${node.callee.name}`);
        }
      },
      CallExpression(node) {
        const callee = node.callee;

        if (
          callee.type === "Identifier" &&
          callee.name === "require" &&
          node.arguments.length === 1 &&
          node.arguments[0].type === "Literal"
        ) {
          reportImport(node, node.arguments[0].value);

          return;
        }

        if (callee.type === "Identifier" && callee.name === "fetch") {
          reportNetwork(node, "fetch");

          return;
        }

        if (
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.property.type === "Identifier"
        ) {
          const host =
            callee.object.type === "Identifier" ? callee.object.name : null;

          if (callee.property.name === "fetch" && GLOBAL_HOSTS.has(host)) {
            reportNetwork(node, "fetch");

            return;
          }

          if (callee.property.name === "sendBeacon" && host === "navigator") {
            reportNetwork(node, "navigator.sendBeacon");
          }
        }
      },
    };
  },
};
