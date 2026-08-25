import defaultExportMatchesFilename from "./rules/default-export-matches-filename.mjs";
import noInlineStyles from "./rules/no-inline-styles.mjs";
import requireFetchTimeout from "./rules/require-fetch-timeout.mjs";
import preferEnforceTrue from "./rules/prefer-enforce-true.mjs";
import preferApiError from "./rules/prefer-api-error.mjs";
import noCatchAsControlFlow from "./rules/no-catch-as-control-flow.mjs";
import noInfraSdkInFloor from "./rules/no-infra-sdk-in-floor.mjs";
import noForwardingClass from "./rules/no-forwarding-class.mjs";
import requireColocatedTests from "./rules/require-colocated-tests.mjs";
import noPropMutation from "./rules/no-prop-mutation.mjs";
import maxBooleanOperators from "./rules/max-boolean-operators.mjs";
import noIoInView from "./rules/no-io-in-view.mjs";
import noSqlInWebUi from "./rules/no-sql-in-web-ui.mjs";
import noRowTypesOutsideModels from "./rules/no-row-types-outside-models.mjs";
import requireSpecLink from "./rules/require-spec-link.mjs";
import requireStatementLinks from "./rules/require-statement-links.mjs";
import requireIntroParagraph from "./rules/require-intro-paragraph.mjs";
import requireStatusMatchesCoverage from "./rules/require-status-matches-coverage.mjs";
import testImportsItsSubject from "./rules/test-imports-its-subject.mjs";

/**
 * eslint-plugin-lore — repo-local ESLint rules codifying Lore house conventions.
 * Loaded by the root eslint.config.mjs via relative import (no build, no publish).
 */
export default {
  meta: { name: "eslint-plugin-lore", version: "0.1.0" },
  rules: {
    "default-export-matches-filename": defaultExportMatchesFilename,
    "test-imports-its-subject": testImportsItsSubject,
    "no-inline-styles": noInlineStyles,
    "require-fetch-timeout": requireFetchTimeout,
    "prefer-enforce-true": preferEnforceTrue,
    "prefer-api-error": preferApiError,
    "no-catch-as-control-flow": noCatchAsControlFlow,
    "no-infra-sdk-in-floor": noInfraSdkInFloor,
    "no-forwarding-class": noForwardingClass,
    "require-colocated-tests": requireColocatedTests,
    "no-prop-mutation": noPropMutation,
    "max-boolean-operators": maxBooleanOperators,
    "no-io-in-view": noIoInView,
    "no-sql-in-web-ui": noSqlInWebUi,
    "no-row-types-outside-models": noRowTypesOutsideModels,
    "require-spec-link": requireSpecLink,
    "require-statement-links": requireStatementLinks,
    "require-intro-paragraph": requireIntroParagraph,
    "require-status-matches-coverage": requireStatusMatchesCoverage,
  },
};
