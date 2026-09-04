/**
 * Canonical house-style Prettier options. Same arrangement as
 * eslint.house-style.mjs: this file is the single source of truth —
 * prettier.config.mjs consumes it here, and sibling repos mirror this file
 * verbatim, byte-comparing their copy against its raw GitHub URL in CI,
 * with their own prettier.config.mjs importing the mirror. Consumers exempt
 * the mirror from their own formatter, so this file is the format authority
 * for its own bytes.
 */
export const houseStylePrettier = {
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  bracketSpacing: true,
  arrowParens: "always",
};
