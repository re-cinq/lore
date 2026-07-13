import path from "node:path";
import { fileURLToPath } from "node:url";
import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import rule from "./no-forwarding-class.mjs";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "no-forwarding-class",
);

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      projectService: {
        allowDefaultProject: ["consumer.ts"],
        defaultProject: "tsconfig.json",
      },
      tsconfigRootDir: FIXTURES,
    },
  },
});

const FORWARDING_CLASS = `import type { UsagePort } from "./usage-port.js";
export class Usage {
  constructor(private readonly port: UsagePort) {}
  logLlmCall(record: string): Promise<void> {
    return this.port.logLlmCall(record);
  }
  processedCounts(): Promise<number> {
    return this.port.processedCounts();
  }
}`;

ruleTester.run("no-forwarding-class", rule, {
  valid: [
    {
      // renaming/transforming methods make a real adapter, not a forwarder
      code: `import { Reshaper } from "./reshaper.js";
import type { UsagePort } from "./usage-port.js";
export function make(port: UsagePort): Reshaper {
  return new Reshaper(port);
}`,
      filename: "consumer.ts",
    },
    {
      // two constructor dependencies — composition, not a pure wrapper
      code: `import type { UsagePort } from "./usage-port.js";
export class Pair {
  constructor(
    private readonly a: UsagePort,
    private readonly b: UsagePort,
  ) {}
  processedCounts(): Promise<number> {
    return this.a.processedCounts();
  }
}`,
      filename: "consumer.ts",
    },
    {
      // constructor with a body does setup work
      code: `import type { UsagePort } from "./usage-port.js";
export class Eager {
  constructor(private readonly port: UsagePort) {
    void this.port.processedCounts();
  }
  processedCounts(): Promise<number> {
    return this.port.processedCounts();
  }
}`,
      filename: "consumer.ts",
    },
  ],
  invalid: [
    {
      // declaration site: every method forwards 1:1 to the injected port
      code: FORWARDING_CLASS,
      filename: "consumer.ts",
      errors: [{ messageId: "forwardingClass" }],
    },
    {
      // usage site: the class resolves cross-file to a forwarder — hand out
      // the port instead; type refs rewritten, dead import specifier removed
      code: `import { Usage } from "./usage.js";
import type { UsagePort } from "./usage-port.js";
export function make(port: UsagePort): Usage {
  return new Usage(port);
}`,
      filename: "consumer.ts",
      output: `
import type { UsagePort } from "./usage-port.js";
export function make(port: UsagePort): UsagePort {
  return port;
}`,
      errors: [{ messageId: "forwardingUsage" }],
    },
  ],
});
