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
      // warn, not error: a repo-wide sweep at the time of writing flagged 22
      // suites — a mix of real copies and tests that legitimately import
      // nothing (architecture boundaries, migrations, CSS tokens). That list is
      // a triage queue, and turning it red would block unrelated work.
      "lore/test-imports-its-subject": "warn",
      "lore/default-export-matches-filename": "error",
      "lore/no-inline-styles": "warn",
      "lore/require-fetch-timeout": "error",
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
