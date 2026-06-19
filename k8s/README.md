# `k8s/` — Agent / Station / AgentDefinition as Kubernetes resources

A standalone subsystem (ADR-031) that models Lore's execution concepts as Kubernetes
custom resources and runs them with a small controller. It is self-contained — it does
**not** touch the existing Lore + LoreTask pipeline, Postgres, or web UI (that integration
is deferred).

## The model in one breath

You define a **recipe** (`AgentDefinition`) and a **running context** (`Station`, which embeds a
Pod template + points at a recipe) — both **once**. To do work, you create an **`Agent`** (one run)
that references a Station and carries `parameters`. A **controller** watches Agents and, for each,
stamps a Kubernetes **Job** from the Station's Pod template, fills the recipe's `{placeholder}`s from
the parameters, runs it, and records the outcome on the Agent's `status`.

```
AgentDefinition (recipe)  ◄── Station (Pod template + recipe ref + history limits)  ◄── Agent (one run + parameters)
        created once                         created once                                  created per run
                                   controller: Agent → Job (stamped from the Station's Pod template)
```

## Plain-terms glossary

- **CRD** — teaches Kubernetes a new kind of object (so `kind: Agent` becomes real, with built-in validation).
- **Custom Resource (CR)** — one such object (`kubectl apply`/`create` a YAML).
- **Controller** — a long-running program that watches CRs and makes them happen.
- **Job / Pod** — a Pod is a running container; a Job runs a Pod once to completion. One Agent run = one Job.
- **Pod template** — a Station *embeds* a Pod definition (the way Deployments/Jobs do); that's how it "extends" a Pod.

## Layout

| Path | What |
|---|---|
| `crds/` | the three CRDs: `AgentDefinition`, `Station`, `Agent` |
| `controller/` | the standalone controller (TypeScript): watch → reconcile → Job; pure logic is unit-tested |
| `client/` | one-call helpers for other in-cluster apps: `launchAgent` / `getAgent` / `watchAgent` / `findAgents` |
| `rbac/` | the controller's permissions, a caller Role, and the Job-pod NetworkPolicy |
| `deploy/` | `kustomization.yaml` (one-shot install) + the controller Deployment + namespace |
| `examples/` | a sample recipe, Station, and Agent |
| `local/` | spin it up on a laptop `kind` cluster and watch it work — see `local/README.md` |

## Run it locally

See [`local/README.md`](local/README.md): `minikube start` (or `kind create cluster`) →
`kubectl apply -k k8s` → apply the examples → `kubectl get agents -w`. Verified end-to-end: an
`Agent` reconciles `Pending → Running → Succeeded`, with the recipe prompt rendered from the run's
parameters showing up in `status.output`.

## Start a run from code (another in-cluster app)

```ts
import { launchAgent, watchAgent } from "@re-cinq/lore-agent-client";

const { name } = await launchAgent({
  station: "node-fixer",
  parameters: { ticket: "ENG-417", repo: "re-cinq/lore", branch: "fix/x" },
  labels: { "lore.re-cinq.com/ticket": "ENG-417" },
});
await watchAgent(name, (a) => console.log(a.status?.phase)); // Pending → Running → Succeeded
```

## Status / what's deferred

First version proves the loop with a **trivial container image** (the example Station echoes and exits).
Deferred to later efforts: the real coding-agent runner inside the Job; replacing `LoreTask`; wiring the
existing web UI / Postgres / runner; and the org-default→per-repo recipe merge. See ADR-031.
