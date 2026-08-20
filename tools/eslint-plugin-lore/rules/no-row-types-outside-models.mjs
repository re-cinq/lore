/**
 * no-row-types-outside-models — a table's shape is declared once, in
 * `libs/shared/src/models/`.
 *
 * Before that folder existed, one row was declared up to five times: in a port,
 * in its Pg adapter, in its in-memory double, in a route, and again in web-ui.
 * Two of those copies had already drifted to different spellings of the same key
 * before anyone noticed. This flags a NEW copy appearing outside the one home.
 *
 * The signal is a type whose members are predominantly snake_case — TypeScript
 * fields are camelCase in this repo, so snake_case members mean the author was
 * transcribing columns.
 *
 * What it deliberately does NOT flag, because each is legitimate and a rule that
 * cries wolf gets disabled rather than obeyed:
 *
 *   * anything inside `models/` — that is the destination, not the offence;
 *   * fewer than {@link MIN_MEMBERS} members, which is a projection ("this read
 *     wants three columns"), not a table restatement;
 *   * test doubles and tests, which flatten columns they do not own on purpose
 *     (a fact's `agent_id` reaches it through the memory that produced it);
 *   * `PipelineTask`, the one wire type held to its model by a compile-time
 *     assertion rather than by being the model — flipping it is expand/contract
 *     work across deployed images, not a rename;
 *   * an alias to ANOTHER type — `type X = components["schemas"]["Y"]` is exactly
 *     what this rule wants people to reach for. An alias to an object LITERAL
 *     (`type X = { full_name: string; … }`) is a declaration wearing a different
 *     keyword, and is treated as one.
 *
 * KNOWN LIMITATION: a shape from someone ELSE's API — GitHub's `default_branch`
 * and `html_url`, Anthropic's usage blocks — is snake_case for their reasons, not
 * because a column was transcribed, and nothing structural separates the two. The
 * rule flags those, and the message names the case so a reader can dismiss it
 * without wondering whether the rule knows something they do not. Exempting by
 * filename would be a guess that rots the first time such a type moves.
 *
 * Detect-only. The fix is a judgement per type — model it, derive it, or keep it
 * as a projection — which is not a codemod.
 */

const MODELS_DIR = "/libs/shared/src/models/";

/** Files that legitimately transcribe columns they do not own. */
const EXEMPT_FILE = /(-memory\.ts|\.test\.ts|\.test\.tsx|\/fixtures\/)$/;

/** Held to its model by an assertion instead of being one; see `types.ts`. */
const EXEMPT_NAMES = new Set(["PipelineTask"]);

/**
 * Below this, a snake_case type is a projection rather than a table. Three is
 * the smallest shape that reads as "a row" rather than "the columns I asked
 * for"; `JobRunRecord { startedAt }` should never trip this.
 */
const MIN_MEMBERS = 3;

const isSnake = (name) => /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(name);

function memberNames(body) {
  return body
    .filter((m) => m.type === "TSPropertySignature" && m.key)
    .map((m) => m.key.name ?? m.key.value)
    .filter((n) => typeof n === "string");
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "declare a table's shape once, in libs/shared/src/models/, instead of restating its columns",
    },
    schema: [],
    messages: {
      rowTypeOutsideModels:
        '"{{name}}" restates a table\'s columns outside libs/shared/src/models/. Declare the table there (schema + inferred type + ColumnMap) and derive this from it — `fromRow`/`selectList` for a query, `wireSchema` for a published body. If this is a projection rather than a row, keep it and name the columns it actually reads.',
    },
  },

  create(context) {
    const file = context.filename.replace(/\\/g, "/");

    if (file.includes(MODELS_DIR) || EXEMPT_FILE.test(file)) {
      return {};
    }

    /** Report when a declaration's members are predominantly snake_case. */
    function check(id, members) {
      const name = id?.name;

      if (!name || EXEMPT_NAMES.has(name) || members.length < MIN_MEMBERS) {
        return;
      }
      const snake = members.filter(isSnake).length;

      if (snake * 2 > members.length) {
        context.report({
          node: id,
          messageId: "rowTypeOutsideModels",
          data: { name },
        });
      }
    }

    return {
      TSInterfaceDeclaration(node) {
        check(node.id, memberNames(node.body.body));
      },
      // `type X = { … }` is the same declaration with a different keyword. An
      // alias to any OTHER type is untouched, which is what keeps the generated
      // `components["schemas"][…]` alias — the thing this rule points people at
      // — from tripping it.
      TSTypeAliasDeclaration(node) {
        if (node.typeAnnotation?.type === "TSTypeLiteral") {
          check(node.id, memberNames(node.typeAnnotation.members));
        }
      },
    };
  },
};
