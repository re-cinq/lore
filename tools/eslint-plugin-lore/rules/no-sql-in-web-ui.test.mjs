import { RuleTester } from "eslint";
import rule from "./no-sql-in-web-ui.mjs";

const ruleTester = new RuleTester();

const WEBUI_FILE = "/repo/apps/web-ui/src/app/tasks/[id]/page.tsx";

ruleTester.run("no-sql-in-web-ui", rule, {
  valid: [
    // the same query outside apps/web-ui is out of this rule's boundary
    {
      code: `const rows = await query("SELECT id FROM pipeline.tasks WHERE id = $1");`,
      filename: "/repo/apps/lore-api/src/api/routes/tasks/task-by-pr.ts",
    },
    // prose that happens to contain the words — the keywords are not SQL-cased
    {
      code: `const hint = "Select a repo from the list to continue";`,
      filename: WEBUI_FILE,
    },
    // an API path, not a query
    {
      code: "const url = `/api/repos/${owner}/${repo}/tasks`;",
      filename: WEBUI_FILE,
    },
    // SQL keywords embedded in an identifier-shaped constant
    {
      code: `const header = "FROM_ADDRESS";`,
      filename: WEBUI_FILE,
    },
  ],
  invalid: [
    {
      code: `const rows = await query("SELECT id FROM pipeline.tasks WHERE id = $1");`,
      filename: WEBUI_FILE,
      errors: [{ messageId: "sqlInWebUi" }],
    },
    {
      // template literal, interpolated table name
      code: "const rows = await query(`SELECT * FROM ${schema}.chunks LIMIT 10`);",
      filename: WEBUI_FILE,
      errors: [{ messageId: "sqlInWebUi" }],
    },
    {
      // multi-line query — SELECT and FROM sit on different lines
      code: "const rows = await query(`\n  SELECT id, status\n  FROM pipeline.tasks\n`);",
      filename: WEBUI_FILE,
      errors: [{ messageId: "sqlInWebUi" }],
    },
    {
      code: `await query("INSERT INTO lore.repos (owner, name) VALUES ($1, $2)");`,
      filename: WEBUI_FILE,
      errors: [{ messageId: "sqlInWebUi" }],
    },
    {
      code: `await query("UPDATE pipeline.tasks SET status = $1 WHERE id = $2");`,
      filename: WEBUI_FILE,
      errors: [{ messageId: "sqlInWebUi" }],
    },
    {
      code: `await query("DELETE FROM lore.repos WHERE id = $1");`,
      filename: WEBUI_FILE,
      errors: [{ messageId: "sqlInWebUi" }],
    },
    {
      // DDL is a query too
      code: `await query("CREATE TABLE lore.repos (id int)");`,
      filename: WEBUI_FILE,
      errors: [{ messageId: "sqlInWebUi" }],
    },
    {
      // a test asserting on SQL is still SQL living in web-ui
      code: `expect(sql).toContain("SELECT id FROM pipeline.tasks");`,
      filename: "/repo/apps/web-ui/src/lib/chunk-union.test.ts",
      errors: [{ messageId: "sqlInWebUi" }],
    },
  ],
});
