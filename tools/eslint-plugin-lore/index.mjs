import preferEnforceTrue from "./rules/prefer-enforce-true.mjs";
import requireColocatedTests from "./rules/require-colocated-tests.mjs";

/**
 * eslint-plugin-lore — repo-local ESLint rules codifying Lore house conventions.
 * Loaded by the root eslint.config.mjs via relative import (no build, no publish).
 */
export default {
  meta: { name: "eslint-plugin-lore", version: "0.1.0" },
  rules: {
    "prefer-enforce-true": preferEnforceTrue,
    "require-colocated-tests": requireColocatedTests,
  },
};
