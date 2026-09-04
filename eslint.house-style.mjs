/**
 * Canonical house-style lint rules: mandatory braces + blank-line padding.
 * This file is the single source of truth — eslint.config.mjs consumes it
 * here, and sibling repos mirror it verbatim, byte-comparing their copy
 * against this file's raw GitHub URL in CI (the same arrangement mirrors
 * .prettierrc). Consumers exempt their mirror from their own formatter, so
 * this file is the format authority for its own bytes.
 *
 * Rules-only and import-free on purpose: each consumer binds its own
 * `@stylistic/eslint-plugin` instance, so the mirror drags no dependencies
 * into consuming repos.
 */
export const houseStyleRules = {
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
};
