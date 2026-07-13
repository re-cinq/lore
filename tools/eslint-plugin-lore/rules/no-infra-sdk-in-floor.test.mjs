import { RuleTester } from "eslint";
import rule from "./no-infra-sdk-in-floor.mjs";

const ruleTester = new RuleTester();

const FLOOR_FILE = "/repo/apps/floor/src/jobs/agent/agent-events-store.ts";

ruleTester.run("no-infra-sdk-in-floor", rule, {
  valid: [
    // the same import outside apps/floor is out of this rule's boundary
    {
      code: `import { Storage } from "@google-cloud/storage";`,
      filename: "/repo/apps/lore-api/src/api/routes/dist/dist.ts",
    },
    // floor importing the shared port adapters is the sanctioned path
    {
      code: `import { GcsArchive } from "@re-cinq/lore-shared/project/archive/archive-gcs.js";`,
      filename: FLOOR_FILE,
    },
    // telemetry bootstrap SDKs are deliberately outside the forbidden list
    {
      code: `const { MetricExporter } = await import("@google-cloud/opentelemetry-cloud-monitoring-exporter");`,
      filename: "/repo/apps/floor/src/otel-init.ts",
    },
  ],
  invalid: [
    {
      code: `import { Storage } from "@google-cloud/storage";`,
      filename: FLOOR_FILE,
      errors: [{ messageId: "infraSdkInFloor" }],
    },
    {
      // subpath imports are the same SDK
      code: `import { Bucket } from "@google-cloud/storage/build/src/bucket.js";`,
      filename: FLOOR_FILE,
      errors: [{ messageId: "infraSdkInFloor" }],
    },
    {
      // dynamic import
      code: `const { Storage } = await import("@google-cloud/storage");`,
      filename: FLOOR_FILE,
      errors: [{ messageId: "infraSdkInFloor" }],
    },
    {
      // require
      code: `const { Storage } = require("@google-cloud/storage");`,
      filename: FLOOR_FILE,
      errors: [{ messageId: "infraSdkInFloor" }],
    },
  ],
});
