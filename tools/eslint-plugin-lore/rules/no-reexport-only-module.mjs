/**
 * no-reexport-only-module — a module whose whole top level is `export … from`
 * forwards a name without owning anything. It reads as a module and costs an
 * import hop, but no decision lives in it.
 *
 * The rule exists because a size budget (`max-lines`) can be satisfied by
 * moving every body out of a file and leaving the exports behind. That turns a
 * too-large module into a barrel without anyone deciding the module was the
 * wrong shape, and the next reader still has to open every sibling to find the
 * code. Either point callers at the real modules, or leave something here that
 * composes them.
 *
 * A file is flagged when it has at least one `export … from` / `export *` and
 * no other top-level statement except imports. Imports do not rescue a file:
 * an import feeding only a re-export is still forwarding. Anything that
 * declares or runs (a function, a const, a local `export {}` of something
 * declared above, a default export) makes it a real module.
 *
 * `index.ts`/`index.tsx` are exempt by default — a package's public surface is
 * exactly the case where forwarding IS the job — and so are the Next App Router
 * files (`page`/`layout`/`route`), which a framework requires to EXIST at a
 * path; forwarding the component is the only body they can have. Add more
 * escape hatches with `{ allow: ["public-api.ts"] }`, matched against the
 * file's basename or the tail of its path.
 */

const DEFAULT_ALLOW = [
  "index.ts",
  "index.tsx",
  "index.mjs",
  "index.js",
  "page.tsx",
  "layout.tsx",
  "route.ts",
];

function isReexport(statement) {
  if (statement.type === "ExportAllDeclaration") return true;
  return (
    statement.type === "ExportNamedDeclaration" && statement.source != null
  );
}

function isNeutral(statement) {
  return statement.type === "ImportDeclaration";
}

function isExempt(filename, allow) {
  const normalized = filename.replace(/\\/g, "/");
  return allow.some(
    (entry) => normalized === entry || normalized.endsWith(`/${entry}`),
  );
}

export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "disallow modules whose entire top level is re-exports — forward from an index, not from a body-less module",
    },
    schema: [
      {
        type: "object",
        properties: {
          allow: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      reexportOnly:
        "This module only re-exports; nothing is decided here. Point callers at the real modules, or give it a body that composes them.",
    },
  },

  create(context) {
    const allow = context.options[0]?.allow ?? DEFAULT_ALLOW;
    const filename = context.filename ?? context.getFilename();

    return {
      Program(node) {
        if (isExempt(filename, allow)) return;
        const meaningful = node.body.filter(
          (statement) => !isNeutral(statement),
        );
        if (meaningful.length === 0) return;
        if (!meaningful.every(isReexport)) return;
        context.report({ node, messageId: "reexportOnly" });
      },
    };
  },
};
