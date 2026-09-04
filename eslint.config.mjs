import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import stylistic from "@stylistic/eslint-plugin";
import markdown from "@eslint/markdown";
import lore from "./tools/eslint-plugin-lore/index.mjs";

/**
 * Repo-wide ESLint (flat config). One common linter across every package plus the
 * repo-local `lore` plugin (custom house rules). Type-aware via projectService so
 * typed rules run against each package's own tsconfig (there is no shared base).
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      // routes/dist is SOURCE (the /dist download endpoint), not build output
      "!apps/lore-api/src/api/routes/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      // A git worktree is a SECOND checkout of this repo living inside it
      // (gitignored, .gitignore:48). Linting it re-reports every finding in the
      // tree under a path that is not source — 6k duplicate errors, and a
      // spec-link check that resolves its corpus against the wrong root.
      "**/.claude/worktrees/**",
      "**/coverage/**",
      "**/.lore-pgdata/**",
      "**/.lore-dgraphdata/**",
      "apps/lore-code-trace/**",
      "tools/eslint-plugin-lore/**",
      "**/next-env.d.ts",
      // Generated from apps/lore-api/openapi.json by openapi-typescript — its
      // output does not follow the repo's stylistic rules and must not be edited.
      "apps/web-ui/src/lib/api/schema.d.ts",
    ],
  },

  // Type-aware TypeScript across all first-party packages.
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    plugins: { lore },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "lore/prefer-enforce-true": "error",
      "lore/no-catch-as-control-flow": "error",
      "lore/no-infra-sdk-in-floor": "error",
      "lore/no-forwarding-class": "error",
      "lore/require-colocated-tests": "error",
      "lore/no-prop-mutation": "error",
      "lore/max-boolean-operators": ["error", { max: 2 }],
      "lore/no-io-in-view": "error",
      "lore/require-spec-link": "error",
      // Repo-WIDE on purpose. A table restated in a port, an adapter or a route
      // is the same defect as one restated in a view, and scoping this to
      // web-ui would guard the tier least likely to reach a database. Starts at
      // `warn`: the existing copies are a decision per type (model it, derive
      // it, or keep it as a genuine projection), not a codemod. See #1418
      // and #1421 for the surveys.
      "lore/no-row-types-outside-models": "warn",
      // error since 2026-09-04. The 22-suite queue split exactly as the first
      // draft of this note guessed: 16 suites whose subject is an artifact
      // rather than a module (boundaries, migrations, CSS tokens) now pass
      // honestly, because reading the file IS loading the subject; the other 6
      // were real copies and now import the thing they test. One had drifted —
      // a Slack HMAC helper whose parameter order was reversed.
      "lore/test-imports-its-subject": "error",
      // error from day one: the rollout sweep fixed all 195 pre-existing sites
      // (guard clauses, two-ifs splits, wrapped-tail flips) in the same branch
      // that introduced the rule, so there is no triage queue to stay yellow for.
      "lore/prefer-early-return": "error",
      "lore/default-export-matches-filename": "error",
      "lore/no-inline-styles": "error",
      "lore/require-fetch-timeout": "error",
      // error from day one, mirroring the `prefer-early-return` rollout: the
      // introduction sweep fixed every pre-existing site (204 nested ifs, 109
      // nested loops, 41 nested ternaries) in the same branch, so there is no
      // triage queue to stay yellow for. `max-nested-callbacks` was already at
      // zero when it arrived.
      "lore/no-nested-if": "error",
      "lore/no-nested-loop": "error",
      "no-nested-ternary": "error",
      "max-nested-callbacks": ["error", { max: 3 }],
      // The craftsmanship triage queues. Each is a warn because every site is
      // a decision (compress or delete prose; extract, split, rename; regroup
      // a signature into a typed options interface), not a codemod, and
      // turning them red would block unrelated work. Promotion condition for
      // all five: error when the queue hits zero. Queue sizes at introduction
      // (2026-09-03, after the nesting sweep): max-comment-lines 5644,
      // max-lines-per-function 1334, complexity 582, no-vague-names 291,
      // max-params 81. max-comment-lines and max-params reached zero on
      // 2026-09-04 and are promoted; two queues remain.
      "max-params": ["error", { max: 4 }],
      "lore/max-comment-lines": ["error", { max: 1 }],
      "lore/no-vague-names": "warn",
      // Enforced at 100 as of 2026-09-04: a RATCHET, not the target. 100 is
      // the strictest bound the repo currently meets, so it is the strictest
      // one that can be red without blocking unrelated work; the target is
      // still 20. A rule carries ONE severity, so nothing between 20 and 100
      // is reported any more — to see what is left against the target, drop
      // `max` here and run eslint, then put it back. Lower it for real as that
      // queue drains (it was ~1,400 functions on 2026-09-04). Three functions
      // carry an inline disable with the reason they are not split (a d3
      // canvas renderer, a test harness whose closures share state, and a
      // composition root).
      "max-lines-per-function": [
        "error",
        { max: 100, skipBlankLines: true, skipComments: true },
      ],
      complexity: ["warn", 6],
    },
  },

  // An HTTP refusal is a precondition, so it goes through the same bouncer as
  // every other guard. Scoped to the two hapi servers — the rule rewrites to
  // `apiError`, and each server owns its own copy of that helper (shared cannot
  // hold it without dragging @hapi/boom into the lean MCP adapter, ADR-032).
  {
    files: ["apps/lore-api/src/**/*.ts", "apps/floor/src/**/*.ts"],
    rules: { "lore/prefer-api-error": "error" },
  },

  // SVG transforms and measured iframe heights are computed per render — there is
  // no class that can express them, so these turn the style rule off by path
  // rather than accumulating inline disables.
  {
    files: [
      "apps/web-ui/src/app/repos/**/graph/**",
      // `*`, not the literal `[id]` segment: minimatch reads `[id]` as a character
      // class, so the bracketed form silently matched nothing and the file kept
      // reporting.
      "apps/web-ui/src/app/repos/**/features/*/MockupSection.tsx",
    ],
    rules: { "lore/no-inline-styles": "off" },
  },

  // Reserved Next filenames outside the features vertical still declare their
  // component inline (57 of them). The convention lands vertical by vertical:
  // delete a path from `ignores` as each one converts, and delete this whole
  // block when the list is empty. Non-reserved files are already at zero
  // violations, so that half is enforced everywhere from day one.
  {
    files: [
      "apps/web-ui/src/app/**/{page,layout,error,loading,template,not-found,global-error,default}.tsx",
    ],
    ignores: ["apps/web-ui/src/app/repos/**/features/**"],
    rules: {
      "lore/default-export-matches-filename": ["error", { reserved: "off" }],
    },
  },

  // House style everywhere (JS + TS, incl. scripts/.mjs and tests): mandatory
  // braces + blank-line padding. Rules-only so it layers onto each file's parser
  // without touching the type-aware setup above.
  {
    files: ["**/*.{ts,tsx,mts,cts,mjs,cjs,js}"],
    plugins: { "@stylistic": stylistic },
    rules: {
      curly: ["error", "all"],
      "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "*", next: "return" },
        { blankLine: "always", prev: "import", next: "*" },
        { blankLine: "any", prev: "import", next: "import" },
        { blankLine: "always", prev: ["const", "let", "var"], next: "*" },
        {
          blankLine: "any",
          prev: ["const", "let", "var"],
          next: ["const", "let", "var"],
        },
        {
          blankLine: "always",
          prev: "*",
          next: ["if", "for", "while", "switch", "try", "do"],
        },
      ],
    },
  },

  // web-ui: Next 15 / React 19, browser + node globals, react-hooks correctness rules.
  //
  // `no-sql-in-web-ui` is an ERROR now that the last of the 143 queries has moved
  // behind lore-api. It shipped as a warning while the debt existed, so it marked
  // every site without red-lighting a repo that could not be fixed in one change;
  // that condition is gone, and a warning in a pile of thousands is a wish rather
  // than a fence. `pg` is no longer a web-ui dependency either, so a new query
  // would have to reintroduce the driver to run at all — this rule is what says
  // so at review time instead of at deploy time.
  {
    files: ["apps/web-ui/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/set-state-in-effect": "error",
      "lore/no-sql-in-web-ui": "error",
    },
  },

  // Tooling/config TS not covered by any package tsconfig (root config, scripts,
  // vitest config + setup): lint syntactically, no type info.
  {
    files: [
      "scripts/**/*.ts",
      "**/*.config.{ts,mts}",
      "**/vitest.setup.ts",
      "eslint.config.mjs",
    ],
    languageOptions: {
      parserOptions: { projectService: false, project: false },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/await-thenable": "off",
    },
  },

  // Tests run syntactically (some live outside their package's tsconfig, e.g.
  // lore-station excludes *.test.ts) and may lean on `any` for doubles. Keep the
  // custom + syntactic rules on; drop the type-aware ones.
  {
    files: ["**/*.test.{ts,tsx}"],
    languageOptions: {
      parserOptions: { projectService: false, project: false },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/await-thenable": "off",
      // Zero comments in tests: the test NAME carries the meaning. Queue hit
      // zero on 2026-09-04, so this is an error.
      "lore/max-comment-lines": ["error", { max: 0 }],
      // A describe callback is one function holding every test, so per-function
      // line/callback budgets are meaningless here. Per-it bodies stay covered
      // by complexity and the nesting rules.
      "max-lines-per-function": "off",
      "max-nested-callbacks": "off",
    },
  },

  // Spec/ADR markdown — the statement-side of spec-test coverage. Every testable
  // statement should carry an inline ([validated by](test.ts#Lline)) link; a gap
  // warns. A rejected spec / superseded ADR is skipped. Every doc must also open
  // with a lead paragraph (before the first ## section) so the web-UI spec/ADR
  // cards render a description — a gap errors. Every doc must further declare a
  // parseable lifecycle status matching its test-link coverage (no links → Draft,
  // some → In Progress, all → Shipped) so the status pill and the org backlog
  // cannot outrun what the tests actually validate — a mismatch errors. Scoped to
  // spec.md + ADR bodies — not the exploratory plan.md/tasks.md/research.md
  // siblings. First markdown-language block in the repo.
  {
    files: ["specs/**/spec.md", "adrs/**/*.md"],
    language: "markdown/gfm",
    plugins: { markdown, lore },
    rules: {
      "lore/require-statement-links": "warn",
      "lore/require-intro-paragraph": "error",
      "lore/require-status-matches-coverage": "error",
    },
  },
);
