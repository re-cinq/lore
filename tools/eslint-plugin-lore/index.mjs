import preferEnforceTrue from "./rules/prefer-enforce-true.mjs";
import noCatchAsControlFlow from "./rules/no-catch-as-control-flow.mjs";
import noInfraSdkInFloor from "./rules/no-infra-sdk-in-floor.mjs";
import noForwardingClass from "./rules/no-forwarding-class.mjs";
import requireColocatedTests from "./rules/require-colocated-tests.mjs";

/**
 * eslint-plugin-lore — repo-local ESLint rules codifying Lore house conventions.
 * Loaded by the root eslint.config.mjs via relative import (no build, no publish).
 */
export default {
  meta: { name: "eslint-plugin-lore", version: "0.1.0" },
  rules: {
    "prefer-enforce-true": preferEnforceTrue,
    "no-catch-as-control-flow": noCatchAsControlFlow,
    "no-infra-sdk-in-floor": noInfraSdkInFloor,
    "no-forwarding-class": noForwardingClass,
    "require-colocated-tests": requireColocatedTests,
  },
};
