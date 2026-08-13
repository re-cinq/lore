/**
 * A default export must be findable by its own name.
 *
 * `export default async function NewFeature` lived in `new/page.tsx`: grepping
 * `NewFeature` found nothing, because every page file in the app is called
 * `page.tsx`. So a non-reserved file's default export is named after its file, and
 * a reserved Next filename re-exports one that is.
 *
 * Route-segment config (`dynamic`, `revalidate`, `metadata`, …) is allowed to stay
 * in the reserved file: it MUST be declared literally there, since a re-exported
 * `export const dynamic` is not reliably picked up by Next's build-time analysis.
 *
 * Detect-only. A rename is a file move, not a codemod.
 */

const WEBUI_MARKER = "/apps/web-ui/src/";

/** Route files that render a COMPONENT. Their name is fixed by the framework, so
 *  the component must live in a file named after itself and be re-exported here. */
const PAGE_LIKE = new Set([
  "page",
  "layout",
  "error",
  "loading",
  "not-found",
  "template",
  "default",
  "global-error",
]);

/** Framework entry points whose default export is deliberately not a named
 *  component — `middleware.ts` default-exports `withAuth({...})`, an image file
 *  exports a generator. There is no name to make findable, so the rule skips them
 *  rather than demanding a re-export that would make no sense. */
const FRAMEWORK_ENTRY = new Set([
  "route",
  "middleware",
  "instrumentation",
  "sitemap",
  "robots",
  "manifest",
  "opengraph-image",
  "twitter-image",
  "icon",
  "apple-icon",
]);

/** Exports Next reads off the route module itself. */
const SEGMENT_CONFIG = new Set([
  "dynamic",
  "dynamicParams",
  "revalidate",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
  "experimental_ppr",
  "metadata",
  "generateMetadata",
  "viewport",
  "generateViewport",
  "generateStaticParams",
  "alt",
  "size",
  "contentType",
]);

/** The name a default export declares, or null when it declares none. */
function exportedName(declaration) {
  if (!declaration) {
    return null;
  }

  if (declaration.type === "Identifier") {
    return declaration.name;
  }

  if (
    declaration.type === "FunctionDeclaration" ||
    declaration.type === "ClassDeclaration"
  ) {
    return declaration.id ? declaration.id.name : null;
  }

  // memo(Foo) / forwardRef(Foo) still name the component.
  if (declaration.type === "CallExpression") {
    const named = declaration.arguments.find(
      (arg) => arg.type === "Identifier",
    );

    return named ? named.name : null;
  }

  return null;
}

/** Statements a reserved file may keep alongside its re-export. */
function isAllowedResidue(node) {
  if (
    node.type === "ImportDeclaration" ||
    node.type === "ExportAllDeclaration" ||
    node.type === "TSTypeAliasDeclaration" ||
    node.type === "TSInterfaceDeclaration"
  ) {
    return true;
  }

  if (node.type !== "ExportNamedDeclaration") {
    return false;
  }

  if (node.source) {
    return true;
  }
  const declared = node.declaration;

  if (!declared) {
    return true;
  }

  if (declared.type === "FunctionDeclaration") {
    return declared.id ? SEGMENT_CONFIG.has(declared.id.name) : false;
  }

  if (declared.type === "VariableDeclaration") {
    return declared.declarations.every(
      (d) => d.id.type === "Identifier" && SEGMENT_CONFIG.has(d.id.name),
    );
  }

  return false;
}

export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "a default export's name matches its filename, so the component can be found by grepping its name",
    },
    schema: [
      {
        type: "object",
        properties: { reserved: { enum: ["error", "off"] } },
        additionalProperties: false,
      },
    ],
    messages: {
      nameMismatch:
        '{{file}} default-exports "{{name}}". Rename one of the two so grepping "{{name}}" finds this file.',
      unnamedDefault:
        "{{file}} default-exports something unnamed — name it {{stem}} so the file can be found by its component's name.",
      reservedInlineDefault:
        "{{file}} must re-export its component from a file named after it, not declare it inline — every route file shares this name, so the component is unfindable.",
      reservedNotPureReexport:
        "{{file}} re-exports its default but also declares {{name}}. Keep only imports, the re-export, and route-segment config here.",
    },
  },

  create(context) {
    const filename = (context.filename ?? "").split("\\").join("/");

    if (
      !filename.includes(WEBUI_MARKER) ||
      filename.includes(".test.") ||
      filename.endsWith(".d.ts")
    ) {
      return {};
    }
    const base = filename.slice(filename.lastIndexOf("/") + 1);
    const stem = base.replace(/\.(tsx|ts|jsx|js)$/, "");
    const reservedMode = context.options?.[0]?.reserved ?? "error";

    return {
      Program(node) {
        const defaultDecl = node.body.find(
          (s) => s.type === "ExportDefaultDeclaration",
        );

        if (FRAMEWORK_ENTRY.has(stem)) {
          return;
        }

        if (PAGE_LIKE.has(stem)) {
          if (reservedMode === "off") {
            return;
          }

          if (defaultDecl) {
            context.report({
              node: defaultDecl,
              messageId: "reservedInlineDefault",
              data: { file: base },
            });

            return;
          }
          const reexports = node.body.some(
            (s) =>
              s.type === "ExportNamedDeclaration" &&
              s.source &&
              s.specifiers.some((sp) => sp.exported.name === "default"),
          );

          if (!reexports) {
            return;
          }

          for (const statement of node.body) {
            if (isAllowedResidue(statement)) {
              continue;
            }
            context.report({
              node: statement,
              messageId: "reservedNotPureReexport",
              data: { file: base, name: statementLabel(statement) },
            });
          }

          return;
        }

        if (!defaultDecl) {
          return;
        }
        const name = exportedName(defaultDecl.declaration);

        if (name === null) {
          context.report({
            node: defaultDecl,
            messageId: "unnamedDefault",
            data: { file: base, stem },
          });

          return;
        }

        if (name !== stem) {
          context.report({
            node: defaultDecl.declaration.id ?? defaultDecl,
            messageId: "nameMismatch",
            data: { file: base, name },
          });
        }
      },
    };
  },
};

/** A human-readable label for the statement that does not belong. */
function statementLabel(node) {
  if (node.type === "FunctionDeclaration" && node.id) {
    return node.id.name;
  }

  if (node.type === "VariableDeclaration") {
    const first = node.declarations[0]?.id;

    return first && first.type === "Identifier" ? first.name : "a value";
  }

  return "other code";
}
