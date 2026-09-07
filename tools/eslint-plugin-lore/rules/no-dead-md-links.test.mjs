import { RuleTester } from "eslint";
import markdown from "@eslint/markdown";
import rule from "./no-dead-md-links.mjs";

const ruleTester = new RuleTester({
  plugins: { markdown },
  language: "markdown/gfm",
});

// A file that certainly exists relative to the repo root, and one that cannot.
const REAL = "package.json";
const GONE = "apps/floor/src/does-not-exist.ts";

ruleTester.run("no-dead-md-links", rule, {
  valid: [
    {
      name: "a link to a file that exists",
      code: `See [the manifest](${REAL}).`,
      filename: "specs/x/spec.md",
    },
    {
      name: "an anchor on a live file is stripped before the check",
      code: `See [the manifest](${REAL}#L3).`,
      filename: "specs/x/spec.md",
    },
    {
      name: "external urls are nobody's filesystem",
      code: "See [the docs](https://example.com/a/b.ts).",
      filename: "specs/x/spec.md",
    },
    {
      name: "a bare fragment is a link within the document",
      code: "See [above](#background).",
      filename: "specs/x/spec.md",
    },
    {
      name: "a placeholder inside backticks is code, not a link — no special case needed, inline code never parses as a link node",
      code: "Write `([validated by](path/to/test.ts#Lline))` after the statement.",
      filename: "specs/x/spec.md",
    },
    {
      name: "a leading slash means the repo root, not the filesystem root",
      code: `See [the manifest](/${REAL}).`,
      filename: "specs/x/spec.md",
    },
    {
      name: "a ?query is stripped like an anchor — GitHub's ?plain=1 is not part of the path",
      code: `See [the manifest](${REAL}?plain=1).`,
      filename: "specs/x/spec.md",
    },
    {
      name: "a fenced example is code too",
      code: ["```md", `[gone](${GONE})`, "```"].join("\n"),
      filename: "specs/x/spec.md",
    },
  ],
  invalid: [
    {
      name: "a link to a file that does not exist",
      code: `See [the handler](${GONE}).`,
      filename: "specs/x/spec.md",
      errors: [{ messageId: "dead" }],
    },
    {
      name: "a repo-root link to a missing file still reports",
      code: `See [the handler](/${GONE}).`,
      filename: "specs/x/spec.md",
      errors: [{ messageId: "dead" }],
    },
    {
      name: "an anchor does not rescue a missing file",
      code: `See [the handler](${GONE}#L12).`,
      filename: "specs/x/spec.md",
      errors: [{ messageId: "dead" }],
    },
  ],
});
