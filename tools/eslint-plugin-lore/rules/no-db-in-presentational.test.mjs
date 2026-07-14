import { RuleTester } from "eslint";
import rule from "./no-db-in-presentational.mjs";

const ruleTester = new RuleTester();

const PRESENTATIONAL_FILE = "/repo/apps/web-ui/src/app/pools/PoolsView.tsx";
const CONTAINER_PAGE = "/repo/apps/web-ui/src/app/pools/page.tsx";

ruleTester.run("no-db-in-presentational", rule, {
  valid: [
    // route container fetches and passes props down — the sanctioned path
    {
      code: `import { query } from "@/lib/db";`,
      filename: CONTAINER_PAGE,
    },
    // client container (*Panel) owns fetch state — not presentational
    {
      code: `import { query } from "@/lib/db";`,
      filename: "/repo/apps/web-ui/src/app/repos/assembled/AssembledContextPanel.tsx",
    },
    // presentational component importing a pure helper, not the data layer
    {
      code: `import { paginate } from "./pagination";`,
      filename: PRESENTATIONAL_FILE,
    },
    // same data-layer import outside web-ui is out of this rule's boundary
    {
      code: `import { query } from "@/lib/db";`,
      filename: "/repo/apps/lore-api/src/api/routes/dist/dist.ts",
    },
    // a presentational-named test file is not the component itself
    {
      code: `import { query } from "@/lib/db";`,
      filename: "/repo/apps/web-ui/src/app/pools/PoolsView.test.tsx",
    },
  ],
  invalid: [
    {
      code: `import { query } from "@/lib/db";`,
      filename: PRESENTATIONAL_FILE,
      errors: [{ messageId: "dbInPresentational" }],
    },
    {
      // a leaf presentational component (Timeline) is covered too
      code: `import { queryOne } from "@/lib/db";`,
      filename: "/repo/apps/web-ui/src/app/assembly-lines/[id]/Timeline.tsx",
      errors: [{ messageId: "dbInPresentational" }],
    },
    {
      // dynamic import
      code: `const { query } = await import("@/lib/db");`,
      filename: PRESENTATIONAL_FILE,
      errors: [{ messageId: "dbInPresentational" }],
    },
    {
      // require
      code: `const { query } = require("@/lib/db");`,
      filename: PRESENTATIONAL_FILE,
      errors: [{ messageId: "dbInPresentational" }],
    },
  ],
});
