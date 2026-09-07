/**
 * no-dead-md-links — a markdown link to a repo file must point at a file that
 * exists.
 *
 * `require-spec-link` already resolves the `([validated by …](test.ts#Lnn))`
 * form, but only from the TEST's side: it asks whether each test is linked, not
 * whether each link lands. Every other link in a spec, ADR or README is
 * unchecked, which is how a rename sweep can rewrite `A -> B` for an `A` that
 * was already dead and quietly modernise a lie. That happened twice during the
 * tier migration, and review caught both times, not CI.
 *
 * Placeholders need no special case: this walks the markdown AST, so
 * `([validated by](path/to/test.ts))` written inside backticks is an inlineCode
 * node and never reaches a link node at all.
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** A link we can check: repo-relative, not a URL, not a bare fragment. */
function isRepoPath(url) {
  return (
    url.length > 0 &&
    !/^[a-z][a-z0-9+.-]*:/i.test(url) &&
    !url.startsWith("#") &&
    !url.startsWith("//")
  );
}

export default {
  meta: {
    type: "problem",
    docs: { description: "markdown links to repo files must resolve" },
    schema: [],
    messages: {
      dead: "`{{target}}` does not exist. A link that no longer lands is worse than no link: a rename sweep rewrites it faithfully and the reference reads as current.",
    },
  },

  create(context) {
    const docDir = dirname(context.filename);
    const cwd = context.cwd ?? process.cwd();

    return {
      link(node) {
        const url = node.url ?? "";
        if (!isRepoPath(url)) return;

        // Strip a ?query and a #Lnn anchor; only the file part is a filesystem question.
        const target = url.split(/[?#]/)[0];
        if (!target) return;

        // A leading slash is markdown for the REPO root, not the filesystem root.
        if (target.startsWith("/")) {
          if (existsSync(resolve(cwd, target.slice(1)))) return;
          context.report({ node, messageId: "dead", data: { target } });

          return;
        }

        // Specs write validated-by targets from the repo root and prose links
        // relative to the document, so either resolving is a live link.
        if (existsSync(resolve(docDir, target))) return;
        if (existsSync(resolve(cwd, target))) return;

        context.report({ node, messageId: "dead", data: { target } });
      },
    };
  },
};
