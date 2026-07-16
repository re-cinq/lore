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
      "**/coverage/**",
      "**/.lore-pgdata/**",
      "**/.lore-dgraphdata/**",
      "apps/lore-code-trace/**",
      "tools/eslint-plugin-lore/**",
      "**/next-env.d.ts",
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
  {
    files: ["apps/web-ui/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/set-state-in-effect": "error",
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
  // warns. A rejected spec / superseded ADR is skipped. Scoped to spec.md + ADR
  // bodies — not the exploratory plan.md/tasks.md/research.md siblings. First
  // markdown-language block in the repo.
  {
    files: ["specs/**/spec.md", "adrs/**/*.md"],
    language: "markdown/gfm",
    plugins: { markdown, lore },
    rules: {
      "lore/require-statement-links": "warn",
    },
  },
);
