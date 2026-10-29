import { writeFileSync } from "node:fs";
import { descriptorsFromVitestModules } from "../../dist/domain/spec-trace/trace-descriptors.js";
import { createTraceVitest } from "./trace-vitest.mjs";

const [root, pkg, scope, output] = process.argv.slice(2);
const vitest = await createTraceVitest(root, pkg);

try {
  const specifications = await vitest.getRelevantTestSpecifications([scope]);
  const run = await vitest.collectTests(specifications);

  if (
    run.unhandledErrors.length ||
    run.testModules.some((module) => module.errors().length)
  ) {
    throw new Error("Vitest could not collect the complete test modules");
  }

  writeFileSync(
    output,
    JSON.stringify(
      descriptorsFromVitestModules(run.testModules, {
        pkg,
        executed: false,
      }),
    ),
  );
} finally {
  await vitest.close();
}
