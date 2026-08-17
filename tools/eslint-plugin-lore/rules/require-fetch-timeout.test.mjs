import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import rule from "./require-fetch-timeout.mjs";

const ruleTester = new RuleTester({ languageOptions: { parser: tsParser } });

const FILE = "/repo/apps/floor/src/jobs/watcher/agent-watcher.ts";

ruleTester.run("require-fetch-timeout", rule, {
  valid: [
    {
      code: `await fetch(url, { signal: AbortSignal.timeout(10_000) });`,
      filename: FILE,
    },
    // A caller-supplied signal is a timeout the caller owns.
    { code: `await fetch(url, { signal });`, filename: FILE },
    { code: `await fetch(url, { method: "POST", body, signal: ctl.signal });`, filename: FILE },
    // Spread options may carry the signal; the rule cannot see inside and does not guess.
    { code: `await fetch(url, { ...opts });`, filename: FILE },
    // A method named fetch on something else is not the global.
    { code: `await client.fetch(url);`, filename: FILE },
    { code: `await this.fetch(url, {});`, filename: FILE },
    // The SSE exception is an `eslint-disable-next-line`, which the LINTER
    // applies — RuleTester does not register the rule under its plugin name, so
    // that path is not expressible here. Nothing rule-specific to assert.
  ],
  invalid: [
    {
      code: `await fetch(url);`,
      filename: FILE,
      errors: [{ messageId: "noTimeout" }],
    },
    {
      code: `await fetch(url, { method: "POST", body: "x" });`,
      filename: FILE,
      errors: [{ messageId: "noTimeout" }],
    },
    // `signal: undefined` is an absent timeout wearing the right key.
    {
      code: `await fetch(url, { signal: undefined });`,
      filename: FILE,
      errors: [{ messageId: "noTimeout" }],
    },
  ],
});

console.log("require-fetch-timeout: ok");
