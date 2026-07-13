/**
 * no-infra-sdk-in-floor — the Floor reaches infrastructure through
 * `@re-cinq/lore-shared` port adapters bound as lazy singletons in `kernel/`
 * (ADR-024 "Floor data access"); it never talks to an infra SDK directly.
 * Flags static imports, dynamic `import()`, and `require()` of the forbidden
 * SDKs anywhere under `apps/floor/src/`.
 *
 * Detect-only: the fix is moving the code behind a shared port, not a rewrite.
 *
 * `@google-cloud/opentelemetry-*` stays allowed on purpose — otel-init.ts is
 * process-level telemetry bootstrap, not domain behavior behind a port.
 */

const FLOOR_MARKER = "/apps/floor/src/";
const FORBIDDEN = ["@google-cloud/storage"];

function forbiddenSource(value) {
  return (
    typeof value === "string" &&
    FORBIDDEN.some((sdk) => value === sdk || value.startsWith(`${sdk}/`))
  );
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "disallow direct infra SDK imports in apps/floor — go through @re-cinq/lore-shared port adapters bound in kernel/",
    },
    schema: [],
    messages: {
      infraSdkInFloor:
        "The Floor reaches infrastructure through @re-cinq/lore-shared port adapters bound in kernel/ — don't import {{sdk}} directly.",
    },
  },

  create(context) {
    if (!context.filename.replace(/\\/g, "/").includes(FLOOR_MARKER)) {
      return {};
    }

    function reportIfForbidden(node, value) {
      if (!forbiddenSource(value)) return;
      context.report({
        node,
        messageId: "infraSdkInFloor",
        data: { sdk: value },
      });
    }

    return {
      ImportDeclaration(node) {
        reportIfForbidden(node, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === "Literal") {
          reportIfForbidden(node, node.source.value);
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments.length === 1 &&
          node.arguments[0].type === "Literal"
        ) {
          reportIfForbidden(node, node.arguments[0].value);
        }
      },
    };
  },
};
