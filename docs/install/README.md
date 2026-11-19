# Install Lore

Lore is installed with two Helm charts on one Kubernetes cluster, and every image it pulls is public.

- Lore: the API, the web UI, the stations that do the deterministic steps, and the MCP gateway that agent pods call.
- The floor and the agent subsystem: the engine that runs each agent in its own pod.
- Dgraph, a graph store for memory and traces.
- Two PostgreSQL databases, run by CloudNativePG from the `lore-databases` chart, or your own.
- Utopia, a knowledge graph of your specs and ADRs. It is optional and off by default.

GitHub is the one mandatory external service: a GitHub App and an OAuth App on your organization ([GitHub setup](../github-setup.md)). Besides GitHub you bring a model endpoint (Anthropic, Vertex AI or Microsoft Foundry). Any ingress controller works.

## Words these pages use

| Word | Meaning |
| ---- | ------- |
| assembly line | the steps a piece of work goes through, for example from a ticket to a merged pull request |
| station | one step of an assembly line. An agent does some steps; the stations service does the fixed, scripted ones |
| the floor | the service that runs assembly lines and starts each agent in its own pod. It runs in the namespace `lore-floor` |
| agent subsystem | the controller the floor uses to create agent pods. It is installed with the floor |
| MCP gateway | the address agent pods call to read and write Lore's context. MCP is the protocol coding agents use to call tools |
| courier jobs | Kubernetes CronJobs named `lore-stations-courier-*`. Each one sends a single HTTP request to the stations service at its scheduled time, and the stations service does the work. Every hour one deletes expired memories. Once a day the others remove low-value memories, summarize the week's facts into patterns, and fetch model and cloud costs for the Spend page |
| pack | a git repository of yours with your own agents and assembly lines ([pack layout reference](../using-lore/pack-layout-reference.md)). Optional |

Pick your case:

- [Azure AKS](aks.md), with Microsoft Foundry and Traefik.
- [Google GKE](gke.md), with Vertex AI or Anthropic and Traefik.
- [One machine with kind](local.md), for a trial. It is also the smallest install: GitHub, one model key and nothing else, which is what you get from either cloud page when you skip its Utopia section.

The values you can set are in [`deploy/install`](../../deploy/install/README.md), including the table of Secrets you can create yourself.
