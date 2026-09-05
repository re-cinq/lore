import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import rule from "./no-cross-layer-import.mjs";

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser },
});

const FLOOR = {
  layers: {
    "apps/floor": {
      ".": ["kernel", "jobs", "delivery"],
      kernel: [],
      "jobs/lib": ["kernel", "@re-cinq/lore-shared"],
      "jobs/*": ["kernel", "jobs/lib", "@re-cinq/lore-shared"],
      delivery: ["kernel", "jobs"],
    },
  },
};

const opts = [FLOOR];

ruleTester.run("no-cross-layer-import", rule, {
  valid: [
    {
      name: "a sibling file in the same folder",
      code: `import { x } from "./sibling.js";`,
      filename: "apps/floor/src/jobs/review/code-review.ts",
      options: opts,
    },
    {
      name: "a folder may reach its own descendants",
      code: `import { x } from "./helpers/parse.js";`,
      filename: "apps/floor/src/jobs/review/code-review.ts",
      options: opts,
    },
    {
      name: "a folder its list names",
      code: `import { x } from "../lib/audit.js";`,
      filename: "apps/floor/src/jobs/review/code-review.ts",
      options: opts,
    },
    {
      name: "a descendant of a folder its list names",
      code: `import { x } from "../../kernel/queues/pool.js";`,
      filename: "apps/floor/src/jobs/review/code-review.ts",
      options: opts,
    },
    {
      name: "a cross-package specifier its list names",
      code: `import { x } from "@re-cinq/lore-shared";`,
      filename: "apps/floor/src/jobs/review/code-review.ts",
      options: opts,
    },
    {
      name: "an npm package is never governed",
      code: `import { z } from "zod";\nimport * as fs from "node:fs";`,
      filename: "apps/floor/src/kernel/queues.ts",
      options: opts,
    },
    {
      name: "a package absent from the config is not checked",
      code: `import { x } from "../anything/at/all.js";`,
      filename: "apps/web-ui/src/lib/github.ts",
      options: opts,
    },
    {
      name: "the more specific key wins — jobs/lib may reach kernel",
      code: `import { x } from "../../kernel/queues.js";`,
      filename: "apps/floor/src/jobs/lib/audit.ts",
      options: opts,
    },
    {
      name: "the package root entry reaches what it lists",
      code: `import { x } from "./delivery/http/server.js";`,
      filename: "apps/floor/src/index.ts",
      options: opts,
    },
    {
      name: "a nested folder inherits its parent key rather than falling through",
      code: `import { x } from "../../../kernel/queues.js";`,
      filename: "apps/floor/src/jobs/review/helpers/parse.ts",
      options: opts,
    },
    {
      name: "movement inside a layer is free, including up to an ancestor",
      code: `import { x } from "../api-error.js";`,
      filename: "apps/floor/src/delivery/http/routes/health.ts",
      options: opts,
    },
    {
      name: "a star key makes each domain its own layer, so its subtree is free",
      code: `import { x } from "../decisions.js";`,
      filename: "apps/floor/src/jobs/review/helpers/parse.ts",
      options: opts,
    },
  ],
  invalid: [
    {
      name: "a sibling domain under the same star key",
      code: `import { x } from "../merge/auto-merge.js";`,
      filename: "apps/floor/src/jobs/review/code-review.ts",
      options: opts,
      errors: [{ messageId: "notAllowed" }],
    },
    {
      name: "kernel is a leaf and reaches nothing",
      code: `import { x } from "../jobs/lib/audit.js";`,
      filename: "apps/floor/src/kernel/queues.ts",
      options: opts,
      errors: [{ messageId: "notAllowed" }],
    },
    {
      name: "a cross-package specifier the list omits",
      code: `import { x } from "@re-cinq/lore-server-core";`,
      filename: "apps/floor/src/jobs/review/code-review.ts",
      options: opts,
      errors: [{ messageId: "notAllowed" }],
    },
    {
      name: "jobs/lib is a leaf — the specific key does not inherit jobs/*",
      code: `import { x } from "../review/code-review.js";`,
      filename: "apps/floor/src/jobs/lib/audit.ts",
      options: opts,
      errors: [{ messageId: "notAllowed" }],
    },
    {
      name: "a folder the governed package never lists imports nothing",
      code: `import { x } from "../kernel/queues.js";`,
      filename: "apps/floor/src/listeners/webhook.ts",
      options: opts,
      errors: [{ messageId: "unlistedFolder" }],
    },
    {
      name: "delivery is reachable from the root entry, not from a job",
      code: `import { x } from "../../delivery/http/server.js";`,
      filename: "apps/floor/src/jobs/review/code-review.ts",
      options: opts,
      errors: [{ messageId: "notAllowed" }],
    },
    {
      name: "a dynamic import is governed like a static one",
      code: `const m = await import("../merge/auto-merge.js");`,
      filename: "apps/floor/src/jobs/review/code-review.ts",
      options: opts,
      errors: [{ messageId: "notAllowed" }],
    },
    {
      name: "a re-export is governed like an import",
      code: `export { x } from "../merge/auto-merge.js";`,
      filename: "apps/floor/src/jobs/review/code-review.ts",
      options: opts,
      errors: [{ messageId: "notAllowed" }],
    },
    {
      name: "a nested folder is bound by the parent key it inherits",
      code: `import { x } from "../../merge/auto-merge.js";`,
      filename: "apps/floor/src/jobs/review/helpers/parse.ts",
      options: opts,
      errors: [{ messageId: "notAllowed" }],
    },
  ],
});
