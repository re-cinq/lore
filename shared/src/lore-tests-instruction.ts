/**
 * Canonical, language-agnostic instruction for the onboard task's emission
 * of the Lore test-report CI workflow. The onboarding agent feeds
 * {@link LORE_TESTS_INSTRUCTION} to Claude Code so an agent detects the
 * repo's actual test toolchain and authors `.github/workflows/lore-tests.yml`
 * tailored to the project. One source of truth keeps onboarding emitting a
 * workflow that matches the test-report ingest contract.
 */

export const LORE_TESTS_INSTRUCTION = `Author the Lore test-report CI workflow at \`.github/workflows/lore-tests.yml\` for this project. Detect the actual test framework and coverage tooling from the repo's build files, config, and existing scripts — never assume a runner. Follow these rules exactly:
1. **One workflow job per detected test toolchain.** If the repo is a monorepo with multiple toolchains, emit one job per toolchain, each scoped to its subdirectory using GitHub Actions \`working-directory\` and \`paths\` filters so a change in one toolchain's tree only runs that toolchain's job.
2. **Triggers.** The workflow runs on BOTH \`push\` and \`pull_request\`.
3. **Set up, then collect.** For each job, set up the detected toolchain (its runtime, dependencies, and coverage tooling), then run the repo's \`.lore/test-commands.yml\` \`list\` and \`run\` commands to collect the test descriptors, per-test results, and coverage.
4. **Report.** POST the body \`{ commit, branch, tests, results }\` to \`\${LORE_INGEST_URL}/api/repos/\${{ github.repository }}/test-report\`, and optionally POST bulk coverage to \`\${LORE_INGEST_URL}/api/repos/\${{ github.repository }}/coverage\`. Authenticate with the header \`Authorization: Bearer \${LORE_INGEST_TOKEN}\`. The workflow MUST read the token from \`secrets.LORE_INGEST_TOKEN\` and the base URL from \`vars.LORE_INGEST_URL\` — reuse these exact names (they are the ones \`lore-ingest.yml\` already uses).
5. **Soft-fail.** Tail every Lore call with a soft-fail so a Lore outage never fails the repo's own CI (e.g. append \`|| echo "::warning::Lore test-report ingest failed"\`).
6. **Contract path.** The canonical path for this workflow is \`.github/workflows/lore-tests.yml\` — write it there.
Do not change test behaviour or any test files.`;
