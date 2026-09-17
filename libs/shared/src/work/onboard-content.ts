/** The static and LLM-generated file catalogs onboarding draws from. */
import { LORE_TESTS_INSTRUCTION } from "../lib/lore-tests-instruction.js";

/** Static files that don't need LLM generation */
export const ONBOARD_STATIC_FILES: { path: string; content: string }[] = [
  {
    path: ".claude/settings.json",
    content: JSON.stringify(
      {
        systemPromptSuffix:
          "\n\nYou have access to the Lore MCP server. ALWAYS call get_context as your FIRST action before reading files or answering. Then use lore_search_memory to check what other developers learned. Before session ends, call lore_write_memory with a session summary.",
      },
      null,
      2,
    ),
  },
  {
    path: ".github/ISSUE_TEMPLATE/lore-implementation.yml",
    content: `name: "Lore: Implementation"
description: "Ask Lore to implement something in this repo"
labels: ["lore", "lore:implementation"]
body:
  - type: textarea
    id: description
    attributes:
      label: What should Lore implement?
      description: Describe what you want built. Be specific about files, behavior, and acceptance criteria.
      placeholder: "Add a health check endpoint at /healthz..."
    validations:
      required: true
  - type: input
    id: spec
    attributes:
      label: Spec file (optional)
      description: Path to a spec file in the repo for Lore to follow
      placeholder: "specs/my-feature/spec.md"
`,
  },
  {
    path: ".github/ISSUE_TEMPLATE/lore-review.yml",
    content: `name: "Lore: Review"
description: "Ask Lore to review a PR against conventions"
labels: ["lore", "lore:review"]
body:
  - type: input
    id: pr_number
    attributes:
      label: PR number
      description: The pull request number to review
      placeholder: "42"
    validations:
      required: true
  - type: textarea
    id: focus
    attributes:
      label: Review focus (optional)
      description: Any specific areas to pay attention to
`,
  },
  {
    path: ".github/ISSUE_TEMPLATE/lore-general.yml",
    content: `name: "Lore: General Task"
description: "Ask Lore to do something (docs, runbook, analysis)"
labels: ["lore"]
body:
  - type: textarea
    id: description
    attributes:
      label: What should Lore do?
      description: Describe the task. Lore will use the repo's context.
      placeholder: "Write a runbook for handling database failover..."
    validations:
      required: true
`,
  },
  {
    path: ".github/ISSUE_TEMPLATE/config.yml",
    content: `blank_issues_enabled: true
contact_links:
  - name: Lore Dashboard
    url: https://LORE_UI_DOMAIN
    about: Create tasks directly in the Lore UI
`,
  },
];

export const ONBOARD_FILES: {
  path: string;
  description: string;
  prompt: string;
}[] = [
  {
    path: "AGENTS.md",
    description: "Agent configuration for AI tools",
    prompt:
      "Generate an AGENTS.md file for this repository. Include: context loading order (which files agents should read first), workflow commands (build, test, lint, deploy), commit conventions, PR requirements, and compliance constraints if any. Be specific to this repo's actual tech stack and structure.",
  },
  {
    path: ".github/PULL_REQUEST_TEMPLATE.md",
    description: "PR description template",
    prompt:
      "Generate a GitHub PR template. Include sections: ## Why, ## What Changed, ## Alternatives Considered, ## ADRs & Architecture, ## Testing. Add a checklist for code quality (lint, types, tests, no secrets).",
  },
  {
    path: ".github/workflows/pr-description-check.yml",
    description: "CI check for PR description quality",
    prompt:
      "Generate a GitHub Actions workflow that checks PR descriptions have required sections (## Why, ## What Changed, ## Testing). Use the github.event.pull_request.body context. Run on pull_request opened/edited. Fail if sections are missing.",
  },
  {
    path: ".specify/spec.md",
    description: "System specification",
    prompt:
      "Generate a system specification describing what this repository does based on the code structure, README, and config files. Include: overview, key capabilities, core data model (if applicable), user roles, business rules, and success metrics. Describe the system as it exists today.",
  },
];

/** Onboard scaffold prompt for suggested .lore/test-commands.yml (AC12); language-agnostic, team-reviewed. */
export const TEST_COMMAND_MANIFEST_SCAFFOLD_PROMPT =
  "Generate a suggested `.lore/test-commands.yml` test-command manifest for this repository. Detect the actual test framework and coverage tooling from the repo's build files and config — never assume a runner. Declare three keys: `list` (a shell command that prints to stdout a JSON array of test descriptors `{id, name, file, startLine, endLine, spec?}`, where `id` is the framework's native, stable test node id), `run` (a shell command containing the literal `{selector}` placeholder that runs the single test named by that id with coverage and prints `{passed, covered:[{file, startLine, endLine}]}` or emits an lcov/cobertura report), and `coverage_format` (one of lcov | cobertura | json). For a monorepo, emit a top-level list with one entry per package, each carrying its own `cwd`. This is a suggested scaffold the team reviews and adjusts — do not change any test behaviour.";

/** ADR files are generated dynamically based on what's in the repo. */
export const ADR_TOPICS = [
  {
    slug: "language-choice",
    prompt:
      "Write an ADR for the language/framework choice. Look at package.json, go.mod, Cargo.toml, etc. to determine what was chosen and why it makes sense for this project.",
  },
  {
    slug: "database-choice",
    prompt:
      "Write an ADR for the database choice. Look at config files, schema definitions, docker-compose for DB services. If no database is evident, skip this ADR entirely and respond with just 'SKIP'.",
  },
  {
    slug: "deployment",
    prompt:
      "Write an ADR for the deployment approach. Look at Dockerfile, CI workflows, Kubernetes manifests, serverless configs. Describe what was chosen and why.",
  },
];

/** The deterministic files the Floor commits on the onboarding branch before the agent runs; named in the ticket so the agent knows what is already there. */
export const ONBOARD_DETERMINISTIC_PATHS: readonly string[] = [
  ".github/workflows/lore-ingest.yml",
  ".github/workflows/lore-trace-impact.yml",
  ...ONBOARD_STATIC_FILES.map((file) => file.path),
];

/** The starter ADR paths, numbered from 1 in ADR_TOPICS order. */
export function starterAdrPaths(): string[] {
  return ADR_TOPICS.map(
    (adr, index) =>
      `adrs/ADR-${String(index + 1).padStart(3, "0")}-${adr.slug}.md`,
  );
}

// The onboarding TICKET: the issue body the onboard assembly line implements. It is the whole spec the agent gets, so it names every file owed, with its prompt, and every rule — a one-line description once let an agent redefine the job (#1745).
export function onboardTicketBody(repo: string): string {
  return [
    `Onboard ${repo} into Lore.`,
    "",
    "Lore has already committed the deterministic scaffolding on this branch, so do not rewrite it:",
    ...ONBOARD_DETERMINISTIC_PATHS.map((path) => `- \`${path}\``),
    "",
    "Author the files that need reading this repository. Each one is owed only when it does not exist yet:",
    ...ONBOARD_FILES.map((file) => `- \`${file.path}\` — ${file.prompt}`),
    ...adrLines(),
    `- \`.lore/test-commands.yml\` — only when the repo declares no test-command manifest. ${TEST_COMMAND_MANIFEST_SCAFFOLD_PROMPT}`,
    `- \`.github/workflows/lore-tests.yml\` — only when absent. ${LORE_TESTS_INSTRUCTION}`,
    "",
    "Rules:",
    "- A file that already exists is left untouched — onboarding adds, it never rewrites.",
    "- Do not author `CLAUDE.md`: the repository's owners write it.",
    "- Change no source code, tests, or build configuration.",
    "- Commit the files, push the branch, and stop. Lore opens the pull request from the branch.",
  ].join("\n");
}

function adrLines(): string[] {
  const paths = starterAdrPaths();

  return [
    `- Starter ADRs, only when the repo has no \`adrs/\` or \`docs/\` directory yet — MADR format with YAML frontmatter (adr_number, title, status: accepted, date: today, domains). Skip an ADR whose subject the repo shows no evidence of:`,
    ...ADR_TOPICS.map((adr, index) => `  - \`${paths[index]}\` — ${adr.prompt}`),
  ];
}
