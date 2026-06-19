# Glossary — the execution model

The canonical vocabulary used across Lore's specs and code. Decision records:
[ADR-024](../adrs/ADR-024-ubiquitous-language-execution-model.md) (the vocabulary) and
[ADR-030](../adrs/ADR-030-agent-definition-recipe-and-tool-seam.md) (the AgentDefinition recipe,
the `AgentTool` seam, and the image/compute → Station boundary), and
[ADR-031](../adrs/ADR-031-agent-station-crds.md) (Agent / Station / AgentDefinition as Kubernetes
CRDs in a standalone `k8s/` subsystem — the recipe schema from ADR-030, now stored as custom
resources). Lore is an autonomous software **factory** (Dark Factory, ADR-016, is a *mode* of it).

**Hierarchy: Factory ⊃ Floor(s) ⊃ AssemblyLines ⊃ Stations ⊃ Agents.**

| Term | Definition | Cardinality |
|---|---|---|
| **Factory** | The whole platform — Lore itself. | 1 |
| **Floor** | The long-running coordinator runtime: dispatches Agents onto Stations, runs the AssemblyLines, runs the cron jobs, reaps leases. | 1 → N (per team / cluster / trust tier) |
| **AssemblyLine** | A workflow of Stations with distinct responsibilities that hand off to / wait on each other. | per task |
| **Station** | The running context that pairs an execution image **and compute** with exactly one Agent — a Kubernetes Job pod (cluster) or a local sandbox/worktree (local runner). The execution image is the Station's, not the definition's (ADR-030). | per task-run |
| **Agent** | A single ephemeral run of a coding tool (Claude CLI/API now; codex/cursor behind the `AgentTool` seam) + a prompt (context + task). | per Station |
| **Agent definition** | The stored *config* an Agent runs from — a declarative recipe (`apiVersion`/`kind`/`spec`): model, prompt, tool-access, resources (env/secrets/MCP/repos), output sinks — resolved per repo (project row → org default → `task-types.yaml`). **No image/compute** (those are the Station's, ADR-030). One definition; many Agents run from it. | per task-type (× repo) |

## Usage rules

- **"Agent" is reserved** for the Claude-plus-prompt run. It is *never* the pod
  that hosts it (a **Station**), the coordinator that dispatches it (the
  **Floor**), or the workflow that sequences it (an **AssemblyLine**).
- An **Agent definition** is *config, not a run* — the recipe a Station
  instantiates into an Agent. Say "Agent definition" (or just "definition") for
  the stored row; never call a definition "an Agent". A "session" is the
  developer/operator identity an Agent runs under (the `agent_id` on tasks and
  memories), distinct from both the definition and a single run.
- **Factory** is the whole platform — never a single deployment.
- A **Floor** may be one of several (per team / cluster / trust tier); write
  "the Floor" for the local/default one, "a Floor" when multiplicity matters.

## Mapping to today's code

| Term | Today |
|---|---|
| Floor | `apps/floor` (the `lore-floor` deployment) |
| AssemblyLine | the `workflow` YAML + supervisor graph in `@re-cinq/lore-runner` |
| Station | the `claude-runner` Job pod / the local runner sandbox |
| Agent | the `claude --print` / `Llm` invocation |
| Agent definition | the `lore.agent_definitions` table, reached via `project.agentDefs` (ADR-024) |
