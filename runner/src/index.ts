// @re-cinq/lore-runner — the portable execution kernel.
//
// This package holds the task-execution kernel (workflow graph executor,
// node handlers, workflow loader, deterministic validation, pod CLI entry)
// extracted from the agent so it can run inside any container. It depends
// only on @re-cinq/lore-shared and receives all repo I/O through an injected
// `Project` facade plus the stateless `Llm` singleton — never a bespoke DB,
// Octokit, or K8s client.
//
// Kernel modules land here in Phase 1 / Slice 4. Until then this file marks
// the package root so the workspace builds.

export const RUNNER_PACKAGE = "@re-cinq/lore-runner";
