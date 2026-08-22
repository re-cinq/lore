/**
 * prefer-api-error — a hapi route refuses a request with a PRECONDITION, not an
 * if-return. It rewrites
 *
 *   if (!feature) {
 *     return h.response({ error: "feature not found" }).code(404);
 *   }
 *
 * to
 *
 *   enforceTrue(feature, apiError(404), "feature not found");
 *
 * which reads as the guard it is and narrows the checked expression for every
 * line below it — the if-return form leaves `feature` possibly-null forever.
 * Extra keys beside `error` become `apiError`'s data argument, so a refusal that
 * carries more than prose (the run already in flight, the block that fired)
 * keeps carrying it.
 *
 * Only the shapes the helpers can express are reported. Left alone: a success
 * code, a status computed from data (`.code(gate.code)`, `.code(a ? 404 : 409)`),
 * a body that is not the `{ error }` envelope, an unconditional return, `if/else`,
 * a multi-statement consequent, and — the subtle one — a refusal whose body reads
 * a variable the test narrows. `enforceTrue` asserts its condition AFTER the call,
 * so its own arguments are typed unnarrowed; rewriting `if (inFlight) return
 * h.response({ error: "busy", ...ids(inFlight) }).code(409)` would hand
 * `ids()` the un-narrowed type. Those stay as if-returns.
 *
 * Import targets resolve per file: `enforceTrue` from the shared package, and
 * `apiError` relatively from `apps/lore-api/src/server/api-error.js`. Outside
 * lore-api the pattern is still wrong but the helper's location is unknown, so
 * the report ships without a fix.
 */

import path from "node:path";
import {
  importInjector,
  payloadDependsOnNarrowing,
  positiveConditionText,
  soleStatementOf,
} from "./lib/guard-shape.mjs";

const ENFORCE_SOURCE = "@re-cinq/lore-shared/lib/enforce.js";
const LORE_API_SRC_MARKER = "/apps/lore-api/src/";
const API_ERROR_PATH = "server/api-error.js";

/** Where `apiError` lives relative to the file being fixed, or null off lore-api. */
function apiErrorSourceFor(filename) {
  const unix = filename.replace(/\\/g, "/");
  const idx = unix.indexOf(LORE_API_SRC_MARKER);
  if (idx === -1) return null;
  const srcRoot = unix.slice(0, idx + LORE_API_SRC_MARKER.length);
  const rel = path
    .relative(path.dirname(unix), `${srcRoot}${API_ERROR_PATH}`)
    .replace(/\\/g, "/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/**
 * The `h.response({ … }).code(<4xx|5xx>)` refusal a return statement answers
 * with, decomposed into its message and its extra keys — or null for anything
 * else returning through the same call shape.
 */
function refusalShape(argument) {
  if (
    argument?.type !== "CallExpression" ||
    argument.callee.type !== "MemberExpression" ||
    argument.callee.computed ||
    argument.callee.property.name !== "code" ||
    argument.arguments.length !== 1
  ) {
    return null;
  }
  const status = argument.arguments[0];
  if (
    status.type !== "Literal" ||
    typeof status.value !== "number" ||
    status.value < 400
  ) {
    return null;
  }

  const response = argument.callee.object;
  if (
    response.type !== "CallExpression" ||
    response.callee.type !== "MemberExpression" ||
    response.callee.computed ||
    response.callee.property.name !== "response" ||
    response.arguments.length !== 1 ||
    response.arguments[0].type !== "ObjectExpression"
  ) {
    return null;
  }

  const body = response.arguments[0];
  const message = body.properties.find(
    (property) =>
      property.type === "Property" &&
      !property.computed &&
      (property.key.name ?? property.key.value) === "error",
  );
  if (!message) return null;

  return {
    status: status.value,
    message: message.value,
    extras: body.properties.filter((property) => property !== message),
  };
}

export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "prefer enforceTrue(cond, apiError(status), message) over an if-return that answers h.response({ error }).code(4xx)",
    },
    fixable: "code",
    schema: [],
    messages: {
      preferApiError:
        "Prefer enforceTrue(cond, apiError({{status}}), message) over an if-return refusal — it reads as a precondition and narrows the checked expression.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode;
    const apiErrorSource = apiErrorSourceFor(context.filename);
    const enforceImport = importInjector(
      sourceCode.ast,
      ENFORCE_SOURCE,
      (value) => value.endsWith("enforce.js"),
    );
    const apiErrorImport = importInjector(
      sourceCode.ast,
      apiErrorSource ?? API_ERROR_PATH,
      (value) => value.endsWith("api-error.js"),
    );

    return {
      IfStatement(node) {
        if (node.alternate) return;

        const returnStatement = soleStatementOf(node.consequent, "ReturnStatement");
        if (!returnStatement) return;

        const refusal = refusalShape(returnStatement.argument);
        if (!refusal) return;

        // The rewrite must not strip narrowing the refusal body depends on.
        if (payloadDependsOnNarrowing(node.test, returnStatement.argument)) {
          return;
        }

        const data = refusal.extras.length
          ? `, { ${refusal.extras.map((p) => sourceCode.getText(p)).join(", ")} }`
          : "";
        const call =
          `enforceTrue(${positiveConditionText(node.test, sourceCode)}, ` +
          `apiError(${refusal.status}${data}), ${sourceCode.getText(refusal.message)});`;

        context.report({
          node,
          messageId: "preferApiError",
          data: { status: String(refusal.status) },
          fix: apiErrorSource
            ? (fixer) => [
                fixer.replaceText(node, call),
                ...enforceImport(fixer, "enforceTrue"),
                ...apiErrorImport(fixer, "apiError"),
              ]
            : null,
        });
      },
    };
  },
};
