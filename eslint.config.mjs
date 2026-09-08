import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import stylistic from "@stylistic/eslint-plugin";
import markdown from "@eslint/markdown";
import importX from "eslint-plugin-import-x";
import reLint from "@re-cinq/eslint-plugin-re-lint";

/**
 * Repo-wide ESLint (flat config). One common linter across every package plus the
 * published `@re-cinq/eslint-plugin-re-lint` house rules (key `re-lint`). Type-aware via projectService so
 * typed rules run against each package's own tsconfig (there is no shared base).
 */
const ENFORCE_MODULE = {
  specifier: "@re-cinq/lore-shared/lib/enforce.js",
  sourceDir: "libs/shared/src",
};
const FIRST_PARTY = { firstPartyScopes: ["@re-cinq"] };

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      // routes/dist is SOURCE (the /dist download endpoint), not build output
      "!apps/lore-api/src/api/routes/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      // A git worktree is a SECOND checkout of this repo living inside it
      // (gitignored, .gitignore:48). Linting it re-reports every finding in the
      // tree under a path that is not source — 6k duplicate errors, and a
      // spec-link check that resolves its corpus against the wrong root.
      "**/.claude/worktrees/**",
      "**/coverage/**",
      "**/.lore-pgdata/**",
      "**/.lore-dgraphdata/**",
      "apps/lore-code-trace/**",
      // Deliberately-wrong fixtures; scripts/check-eslint-canaries.sh lints them
      // with --no-ignore and FAILS if the rules stop reporting them.
      "tools/eslint-canaries/**",
      "**/next-env.d.ts",
      // Generated from apps/lore-api/openapi.json by openapi-typescript — its
      // output does not follow the repo's stylistic rules and must not be edited.
      "apps/web-ui/src/lib/api/schema.d.ts",
    ],
  },

  // Type-aware TypeScript across all first-party packages.
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    plugins: { "re-lint": reLint, "import-x": importX },
    settings: {
      "import-x/resolver": {
        typescript: { alwaysTryTypes: true },
      },
      // Without this the plugin cannot parse a .ts dependency, so it sees no
      // imports in it and reports no cycles — a silent pass, not a clean one.
      "import-x/parsers": {
        "@typescript-eslint/parser": [".ts", ".tsx", ".mts", ".cts"],
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "re-lint/prefer-enforce-true": [
        "error",
        { enforceModule: ENFORCE_MODULE },
      ],
      "re-lint/no-catch-as-control-flow": "error",
      "re-lint/no-forwarding-class": "error",
      "re-lint/require-colocated-tests": "error",
      "re-lint/max-boolean-operators": ["error", { max: 2 }],
      "re-lint/require-spec-link": "error",
      // Repo-WIDE on purpose. A table restated in a port, an adapter or a route
      // is the same defect as one restated in a view, and scoping this to
      // web-ui would guard the tier least likely to reach a database. Error
      // since 2026-09-04: the 70-copy queue was decided one type at a time
      // (model it, derive it, or keep a genuine projection). Where a shape is
      // a THIRD PARTY's — GitHub's, an MCP tool's arg names, an on-disk config
      // — it keeps an inline disable naming whose shape it is, because the
      // rule cannot tell those from a transcribed column. See #1418 and #1421.
      "re-lint/no-row-types-outside-models": [
        "error",
        { modelsDir: "libs/shared/src/models", exemptNames: ["PipelineTask"] },
      ],
      // error since 2026-09-04. The 22-suite queue split exactly as the first
      // draft of this note guessed: 16 suites whose subject is an artifact
      // rather than a module (boundaries, migrations, CSS tokens) now pass
      // honestly, because reading the file IS loading the subject; the other 6
      // were real copies and now import the thing they test. One had drifted —
      // a Slack HMAC helper whose parameter order was reversed.
      "re-lint/test-imports-its-subject": ["error", FIRST_PARTY],
      // error from day one: the rollout sweep fixed all 195 pre-existing sites
      // (guard clauses, two-ifs splits, wrapped-tail flips) in the same branch
      // that introduced the rule, so there is no triage queue to stay yellow for.
      "re-lint/prefer-early-return": "error",
      "re-lint/require-fetch-timeout": "error",
      // error from day one, mirroring the `prefer-early-return` rollout: the
      // introduction sweep fixed every pre-existing site (204 nested ifs, 109
      // nested loops, 41 nested ternaries) in the same branch, so there is no
      // triage queue to stay yellow for. `max-nested-callbacks` was already at
      // zero when it arrived.
      "re-lint/no-nested-if": "error",
      "re-lint/no-nested-loop": "error",
      "no-nested-ternary": "error",
      "max-nested-callbacks": ["error", { max: 3 }],
      // The craftsmanship triage queues. Each is a warn because every site is
      // a decision (compress or delete prose; extract, split, rename; regroup
      // a signature into a typed options interface), not a codemod, and
      // turning them red would block unrelated work. Promotion condition for
      // all five: error when the queue hits zero. Queue sizes at introduction
      // (2026-09-03, after the nesting sweep): max-comment-lines 5644,
      // max-lines-per-function 1334, complexity 582, no-vague-names 291,
      // max-params 81. max-comment-lines, max-params and complexity reached
      // zero on 2026-09-04, followed by no-vague-names and
      // no-row-types-outside-models, and all are errors; max-lines-per-function
      // is ratcheted to 100 the same day. `max-lines` below was added after the
      // others closed and reached zero on 2026-09-04; no queue is open now.
      "max-params": ["error", { max: 4 }],
      "re-lint/max-comment-lines": ["error", { max: 1 }],
      "re-lint/no-vague-names": "error",
      // 20 by default, with the packages still draining held at 30 in the
      // override below. This is the same RATCHET that took 100 → 50 → 30 (the
      // last of those closed 2026-09-08): a package is removed from that
      // override in the PR that empties its queue, so no bound is ever
      // unenforced, and 30 → 20 is 1,486 functions — a single global step could
      // only move when every package was ready at once. A rule carries ONE
      // severity, so nothing under the applicable bound is reported; to see what
      // a lower target would cost, set `max` here and run eslint, then put it
      // back. Inline disables carry the reason they are not split (an iterative
      // graph walk, a d3 canvas renderer, a test harness whose closures share
      // state, and a composition root).
      "max-lines-per-function": [
        "error",
        { max: 20, skipBlankLines: true, skipComments: true },
      ],
      complexity: ["error", 6],
      // A module that needs 300 lines to state its job is usually holding more
      // than one. Counting matches max-lines-per-function so the two agree, and
      // tests are exempt below. Queue of 75 drained on 2026-09-04, so this is
      // an error. A budget can say a file is too big but not where its seam
      // belongs, so each split was a named job, never a cut at line 300.
      "max-lines": [
        "error",
        { max: 300, skipBlankLines: true, skipComments: true },
      ],
      // Three queues opened 2026-09-04 against the failure modes a generated
      // patch has that a hand-written one does not. Each starts at `warn` and
      // is promoted at zero, like the queues above. Sizes at introduction:
      // no-unnecessary-condition 307, no-cycle 54, no-reexport-only-module 10.
      //
      // A condition the types say can never fire. Needs type info, so it is off
      // wherever projectService is (tests, scripts). Queue of 307 drained on
      // 2026-09-05, so this is an error — but read the site before deleting a
      // guard, because the third possibility is that the TYPE is wrong. Roughly
      // half the queue was that: a cast dropping `| null` off a nullable
      // column, an interface claiming fields its own Zod schema marks optional,
      // octokit typing a user non-null that GitHub nulls for deleted accounts,
      // and — because `noUncheckedIndexedAccess` is off repo-wide — every
      // `arr[i]` guard. Those were fixed at the declaration, or kept under a
      // disable naming why. A guard around a `let` a callback mutates is also
      // real: TS narrows it back to its initial value and cannot see the write.
      "@typescript-eslint/no-unnecessary-condition": "error",
      // Splitting a file is how an import cycle gets made, and `max-lines`
      // above now forces splitting, so this guards a risk the repo just took
      // on. Cycles resolve at runtime often enough to pass tests and fail in
      // one import order. The `import-x/parsers` setting above is load-bearing:
      // without it this rule reports zero on a repo that had 54. Queue drained
      // on 2026-09-05, so this is an error; 51 of the 54 were the split shape
      // (parent re-exports the extracted sibling, sibling imports its constants
      // back) and were fixed by lifting what both need into a third module.
      // Type-only edges are not counted, which is right — `import type` erases,
      // so it makes no runtime edge, and tsc stops anyone laundering a real
      // value import through it.
      "import-x/no-cycle": ["error", { maxDepth: Infinity }],
      // The other half of that bargain: a size budget can be met by moving
      // every body out and leaving the exports, which satisfies the rule
      // without deciding the module was the wrong shape. Queue of 10 drained on
      // 2026-09-05, so this is an error. Two were dead (nothing imported them),
      // five were back-compat shims whose callers now name the real module, and
      // `index-*.ts` joined the exemption — a barrel that outgrows `max-lines`
      // continues under a second filename and is still the public surface. One
      // carries an inline disable: a folder surface reached by `await import()`.
      "re-lint/no-reexport-only-module": "error",
      // The layering lives in layers.yaml at the repo root, where it can be
      // read as a statement of the architecture rather than inferred from
      // imports. Only packages named there are checked, so it arrives one
      // package at a time; six are described as of 2026-09-05 and the queue
      // each opened is drained, so this is an error. Adding a package is
      // therefore a real piece of work, not a config line: state the layering
      // the package is MEANT to have, then move the code that disagrees.
      // Two sites carry an inline disable naming why they stand.
      "re-lint/no-cross-layer-import": ["error", FIRST_PARTY],
      // The Clean Code rules that arrived with the re-lint package on
      // 2026-09-08. Each is a warn until its queue drains, then an error in
      // the PR that empties it, like every queue above. Sizes at introduction
      // are recorded in the cutover PR.
      "re-lint/no-flag-params": "warn",
      // Error since 2026-09-08: the queue was one comment — a SQL fragment
      // quoted in an in-memory double — and it is reworded as prose.
      "re-lint/no-commented-out-code": "error",
      // Error since 2026-09-08: all 12 sites were a guard's trailing comment,
      // which now sits above the guard it explains rather than after its brace.
      // One of the 12 is in a .mjs script this block's files glob does not
      // reach; it is fixed for consistency, not because the rule saw it.
      "re-lint/no-closing-brace-comments": "error",
      // Error since 2026-09-08: the predicates state the positive case and
      // negate at the use site, the empty-state components are named Empty*,
      // and the 404 views name what is missing. One inline disable stands, on
      // the OpenAPI response key whose name is part of the published contract.
      "re-lint/no-negative-names": "error",
      // Error since 2026-09-08: all five sites became lookup tables keyed by
      // the tag, which a mapped type still checks for exhaustiveness.
      "re-lint/prefer-polymorphism": "error",
      "re-lint/max-member-chain": "warn",
      "re-lint/callee-below-caller": "warn",
      // Error since 2026-09-08: 20 declarations moved down to their first use.
      // The other 19 carry an inline disable, because moving them would change
      // what they capture (a spy installed before the call it records, a clock
      // read before the work it times, a cwd saved before a stub replaces it)
      // or would split a group whose order is the point.
      "re-lint/declare-near-use": "error",
      // Error since 2026-09-08: the in-memory doubles now expose their
      // collections readonly, which also stops a captured reference from
      // desyncing when one is pruned. Off in tests, below.
      "re-lint/no-hybrid-class": "error",
    },
  },

  // Rules that used to gate themselves on the web-ui path now take the scope
  // from here. `prefer-enforce-true` stays off in web-ui, where a thrown
  // precondition has no hapi bouncer to land in.
  {
    files: ["apps/web-ui/src/**/*.{ts,tsx}"],
    rules: {
      "re-lint/prefer-enforce-true": "off",
      "re-lint/no-prop-mutation": "error",
      "re-lint/no-inline-styles": "error",
      "re-lint/default-export-matches-filename": "error",
      "re-lint/no-io-in-view": [
        "error",
        { dataModules: ["@/lib/db", "@/lib/github"] },
      ],
    },
  },

  // The Floor reaches infrastructure through the shared port adapters bound
  // in kernel/, never the vendor SDK directly.
  {
    files: ["apps/floor/src/**/*.ts"],
    rules: {
      "re-lint/no-forbidden-imports": [
        "error",
        {
          forbidden: [
            {
              specifier: "@google-cloud/storage",
              message:
                "The Floor reaches infrastructure through @re-cinq/lore-shared port adapters bound in kernel/, not @google-cloud/storage directly.",
            },
          ],
        },
      ],
    },
  },

  // An in-memory double restates the table it stands in for; that is its job.
  {
    files: ["**/*-memory.ts"],
    rules: { "re-lint/no-row-types-outside-models": "off" },
  },

  // Duplicated blocks, found by jscpd over the same roots `npm run dup` scans.
  // Every clone is reported on both sides with its full range. Warn until the
  // queue drains.
  {
    files: ["{apps,libs}/*/src/**/*.{ts,tsx}"],
    rules: {
      "re-lint/no-duplicate-code": [
        "warn",
        {
          roots: ["apps", "libs"],
          formats: ["typescript", "tsx"],
          minTokens: 50,
          ignore: [
            "**/dist/**",
            "**/.next/**",
            "**/node_modules/**",
            "**/schema.d.ts",
            "**/fixtures/**",
          ],
        },
      ],
    },
  },

  // An HTTP refusal is a precondition, so it goes through the same bouncer as
  // every other guard. Scoped to the two hapi servers — the rule rewrites to
  // `apiError`, and each server owns its own copy of that helper (shared cannot
  // hold it without dragging @hapi/boom into the lean MCP adapter, ADR-032).
  {
    files: ["apps/lore-api/src/**/*.ts", "apps/floor/src/**/*.ts"],
    rules: {
      "re-lint/prefer-api-error": [
        "error",
        {
          enforceModule: ENFORCE_MODULE,
          errorModules: [
            { root: "apps/lore-api/src", path: "server/api-error.js" },
            { root: "apps/floor/src", path: "delivery/http/api-error.js" },
          ],
        },
      ],
    },
  },

  // SVG transforms and measured iframe heights are computed per render — there is
  // no class that can express them, so these turn the style rule off by path
  // rather than accumulating inline disables.
  {
    files: [
      "apps/web-ui/src/app/repos/**/graph/**",
      // `*`, not the literal `[id]` segment: minimatch reads `[id]` as a character
      // class, so the bracketed form silently matched nothing and the file kept
      // reporting.
      "apps/web-ui/src/app/repos/**/features/*/MockupSection.tsx",
    ],
    rules: { "re-lint/no-inline-styles": "off" },
  },

  // Reserved Next filenames outside the features vertical still declare their
  // component inline (57 of them). The convention lands vertical by vertical:
  // delete a path from `ignores` as each one converts, and delete this whole
  // block when the list is empty. Non-reserved files are already at zero
  // violations, so that half is enforced everywhere from day one.
  {
    files: [
      "apps/web-ui/src/app/**/{page,layout,error,loading,template,not-found,global-error,default}.tsx",
    ],
    ignores: ["apps/web-ui/src/app/repos/**/features/**"],
    rules: {
      "re-lint/default-export-matches-filename": ["error", { reserved: "off" }],
    },
  },

  // House style everywhere (JS + TS, incl. scripts/.mjs and tests): mandatory
  // braces + blank-line padding. Rules-only so it layers onto each file's parser
  // without touching the type-aware setup above.
  {
    files: ["**/*.{ts,tsx,mts,cts,mjs,cjs,js}"],
    plugins: { "@stylistic": stylistic },
    rules: {
      curly: ["error", "all"],
      "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "*", next: "return" },
        { blankLine: "always", prev: "import", next: "*" },
        { blankLine: "any", prev: "import", next: "import" },
        { blankLine: "always", prev: ["const", "let", "var"], next: "*" },
        {
          blankLine: "any",
          prev: ["const", "let", "var"],
          next: ["const", "let", "var"],
        },
        {
          blankLine: "always",
          prev: "*",
          next: ["if", "for", "while", "switch", "try", "do"],
        },
      ],
    },
  },

  // web-ui: Next 15 / React 19, browser + node globals, react-hooks correctness rules.
  //
  // `no-sql-in-web-ui` is an ERROR now that the last of the 143 queries has moved
  // behind lore-api. It shipped as a warning while the debt existed, so it marked
  // every site without red-lighting a repo that could not be fixed in one change;
  // that condition is gone, and a warning in a pile of thousands is a wish rather
  // than a fence. `pg` is no longer a web-ui dependency either, so a new query
  // would have to reintroduce the driver to run at all — this rule is what says
  // so at review time instead of at deploy time.
  {
    files: ["apps/web-ui/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/set-state-in-effect": "error",
      "re-lint/no-sql-in-web-ui": "error",
    },
  },

  // Tooling/config TS not covered by any package tsconfig (root config, scripts,
  // vitest config + setup): lint syntactically, no type info.
  {
    files: [
      "scripts/**/*.ts",
      "**/*.config.{ts,mts}",
      "**/vitest.setup.ts",
      "eslint.config.mjs",
    ],
    languageOptions: {
      parserOptions: { projectService: false, project: false },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },

  {
    // Draining toward 20, one package per PR (30 landed 2026-09-08). These stay
    // at 30 meanwhile: a package leaves this list in the same PR that empties
    // its queue, so no bound is ever unenforced. Queue at introduction:
    // web-ui 505, shared 326, floor 220, lore-api 213, mcp-server 73,
    // server-core 50, cluster-agent 43, stations 41, assembly-lines 7,
    // event-router 6, vscode-extension 2 — 1,486 in total.
    files: [
      "apps/web-ui/**/*.{ts,tsx}",
      "apps/floor/**/*.{ts,tsx}",
      "apps/lore-api/**/*.{ts,tsx}",
      "apps/mcp-server/**/*.{ts,tsx}",
      "libs/shared/**/*.{ts,tsx}",
    ],
    rules: {
      "max-lines-per-function": [
        "error",
        { max: 30, skipBlankLines: true, skipComments: true },
      ],
    },
  },

  // Tests run syntactically (some live outside their package's tsconfig, e.g.
  // lore-station excludes *.test.ts) and may lean on `any` for doubles. Keep the
  // custom + syntactic rules on; drop the type-aware ones.
  {
    files: ["**/*.test.{ts,tsx}"],
    languageOptions: {
      parserOptions: { projectService: false, project: false },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      // Zero comments in tests: the test NAME carries the meaning. Queue hit
      // zero on 2026-09-04, so this is an error.
      "re-lint/max-comment-lines": ["error", { max: 0 }],
      // A recording double IS half data and half behaviour: the code under
      // test writes the field and the test reads it. That is the point.
      "re-lint/no-hybrid-class": "off",
      "re-lint/max-expects": "warn",
      "re-lint/no-nondeterministic-tests": "warn",
      // A describe callback is one function holding every test, so per-function
      // line/callback budgets are meaningless here. Per-it bodies stay covered
      // by complexity and the nesting rules.
      "max-lines-per-function": "off",
      "max-nested-callbacks": "off",
      // A suite grows a case at a time and its length is the count of things
      // checked, not a module doing too much. Splitting one scatters assertions
      // about one subject across files for no reading gain.
      "max-lines": "off",
    },
  },

  // Spec/ADR markdown — the statement-side of spec-test coverage. Every testable
  // statement should carry an inline ([validated by](test.ts#Lline)) link; a gap
  // warns. A rejected spec / superseded ADR is skipped. Every doc must also open
  // with a lead paragraph (before the first ## section) so the web-UI spec/ADR
  // cards render a description — a gap errors. Every doc must further declare a
  // parseable lifecycle status matching its test-link coverage (no links → Draft,
  // some → In Progress, all → Shipped) so the status pill and the org backlog
  // cannot outrun what the tests actually validate — a mismatch errors. Scoped to
  // spec.md + ADR bodies — not the exploratory plan.md/tasks.md/research.md
  // siblings. First markdown-language block in the repo.
  {
    files: ["specs/**/spec.md", "adrs/**/*.md"],
    language: "markdown/gfm",
    plugins: { markdown, "re-lint": reLint },
    rules: {
      "re-lint/require-statement-links": "warn",
      "re-lint/require-intro-paragraph": "error",
      "re-lint/require-status-matches-coverage": "error",
    },
  },
  // Every markdown link to a repo file, wherever docs live. `require-spec-link`
  // resolves the validated-by form from the TEST's side — whether each test is
  // linked — and nothing asks whether each link lands. A rename sweep rewrites a
  // dead link as faithfully as a live one, which is how two stale references
  // survived the tier migration. The queue is drained, so this errors: a link
  // that no longer lands is a defect, not a backlog item.
  {
    files: [
      "specs/**/*.md",
      "adrs/**/*.md",
      "docs/**/*.md",
      "runbooks/**/*.md",
      "apps/*/README.md",
      "libs/*/README.md",
      "CLAUDE.md",
    ],
    language: "markdown/gfm",
    plugins: { markdown, "re-lint": reLint },
    rules: { "re-lint/no-dead-md-links": "error" },
  },
);
