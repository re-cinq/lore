# ESLint canaries

Files that are **deliberately wrong**, plus a check that the real ESLint reports
them. If a canary goes quiet, a rule has stopped looking.

## Why

An import rule has two ways to output nothing, and they are indistinguishable:
the code is clean, or the rule never ran. Three times in this rule family the
second happened and looked like the first:

- `import-x/no-cycle` reported zero on a repo with 54 cycles, because without an
  `import-x/parsers` setting it could not parse a `.ts` dependency and so saw no
  imports in it (#1797).
- `lore/no-cross-layer-import` reported zero when ESLint ran from a
  subdirectory, because it resolved targets against `process.cwd()` (#1801).
- The same rule reported zero for a package whose block was indented under
  `aliases:` instead of `layers:` — it parsed, matched no file, and looked like
  a clean adoption (#1811).

Unit tests passed throughout. `RuleTester` feeds a rule inline config and
synthetic filenames, so it exercises the rule's logic and never its
integration: config loading, the resolver, the working directory, file
discovery. Every one of those three failures lived in the part `RuleTester`
cannot reach.

## What is here

`pkg/` is a fake package with a `layers.yaml` entry declaring `kernel` a leaf:

- `src/kernel/a.ts` imports `../jobs/b.js` — a layer violation
- `src/jobs/b.ts` ↔ `src/jobs/c.ts` — a deliberate import cycle

`scripts/check-eslint-canaries.sh` runs the real ESLint over them and fails
unless **both** findings appear. It runs twice: once from the repo root and once
from inside this directory, because the cwd bug only showed from a subdirectory.

These files are in the config's `ignores`, so a normal `eslint .` skips them;
the canary script passes `--no-ignore` to reach them while still using the real
flat config. They are not compiled — no workspace references them.

## Adding one

When a rule's silence could mean "not looking", add a violating fixture and
assert it in the script. The bar is: would this fixture have caught the bug you
just fixed?

Type-aware rules (`no-unnecessary-condition`, `no-forwarding-class`) have the
same failure mode — both return nothing when type information is missing — but
need a fixture inside a real tsconfig project to be meaningful. Not covered yet.
