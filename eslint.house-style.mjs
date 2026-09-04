/**
 * Canonical house-style lint rules: mandatory braces + blank-line padding.
 * This file is the single source of truth — eslint.config.mjs consumes it
 * here, and sibling repos consume it as a git dependency
 * (`"@re-cinq/lore": "github:re-cinq/lore#main"`), which is why the root
 * package.json carries `name`, `version`, and a `files` allowlist.
 *
 * Rules-only and import-free on purpose: each consumer binds its own
 * `@stylistic/eslint-plugin` instance, so this module drags no dependencies
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
