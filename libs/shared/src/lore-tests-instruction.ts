/**
 * Canonical, language-agnostic instruction for the onboard task's emission
 * of the Lore test-report CI workflow. The onboarding agent feeds
 * {@link LORE_TESTS_INSTRUCTION} to Claude Code so an agent detects the
 * repo's actual test toolchain and authors `.github/workflows/lore-tests.yml`
 * tailored to the project. One source of truth keeps onboarding emitting a
 * workflow that matches the test-report ingest contract.
 */

export const LORE_TESTS_INSTRUCTION = `Author the Lore test-report CI workflow at \`.github/workflows/lore-tests.yml\` for this project. The test orchestration — reading \`.lore/test-commands.yml\`, running its \`list\` and \`run\` commands, collecting per-test coverage, chunking, and posting to Lore — is done by Lore's prebuilt \`lore-code-trace\` binary. Your job is ONLY to set up the repo's test toolchain and run that binary. Detect the actual test toolchain from the repo's build files — never assume a runner. Follow these rules exactly:
1. **One workflow job per detected test toolchain.** If the repo is a monorepo with multiple toolchains, emit one job per toolchain, each scoped to its subdirectory using GitHub Actions \`working-directory\` and \`paths\` filters so a change in one toolchain's tree only runs that toolchain's job.
2. **Triggers.** The workflow runs on BOTH \`push\` and \`pull_request\`.
3. **Set up the toolchain.** For each job, set up the detected toolchain (its runtime, dependencies, and coverage tooling) so the repo's \`.lore/test-commands.yml\` \`list\` and \`run\` commands can execute.
4. **Fetch the orchestrator.** Download \`\${LORE_INGEST_URL}/dist/lore-code-trace/linux-amd64\` (use \`linux-arm64\` on ARM runners), verify it against \`\${LORE_INGEST_URL}/dist/lore-code-trace/checksums.txt\` with \`sha256sum\`, then \`chmod +x\` it. \`LORE_INGEST_URL\` comes from \`vars.LORE_INGEST_URL\` (the same var \`lore-ingest.yml\` uses).
5. **Run + ingest.** Run \`./lore-code-trace --post\`. It reads \`.lore/test-commands.yml\`, runs the suite, and POSTs the report to Lore's ci-tests ingress. Pass \`LORE_WEBHOOK_URL\` (from \`vars.LORE_WEBHOOK_URL\`) and \`LORE_INGEST_TOKEN\` (from \`secrets.LORE_INGEST_TOKEN\`) as env — reuse these exact names.
6. **Soft-fail.** Tail the run with a soft-fail so a Lore outage never fails the repo's own CI (e.g. append \`|| echo "::warning::Lore test ingest failed"\`).
7. **Contract path.** The canonical path for this workflow is \`.github/workflows/lore-tests.yml\` — write it there.
Do not change test behaviour or any test files.`;
