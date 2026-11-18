# Install Lore

Lore is installed with two Helm charts on one Kubernetes cluster, and every image it pulls is public.

- Lore: the API, the web UI, the stations that do the deterministic steps, and the MCP gateway that agent pods call.
- The floor and the agent subsystem: the engine that runs each agent in its own pod.
- Dgraph, a graph store for memory and traces.
- Two PostgreSQL databases, run by CloudNativePG from the `lore-databases` chart, or your own.
- Utopia, a knowledge graph of your specs and ADRs. It is optional and off by default.

GitHub is the one mandatory external service: a GitHub App and an OAuth App on your organization ([GitHub setup](../github-setup.md)). Besides GitHub you bring a model endpoint (Anthropic, Vertex AI or Microsoft Foundry). Any ingress controller works.

Pick your case:

- [Azure AKS](aks.md), with Microsoft Foundry and Traefik.
- [Google GKE](gke.md), with Vertex AI or Anthropic and Traefik.
- [One machine with kind](local.md), for a trial. It is also the smallest install: GitHub, one model key and nothing else, which is what you get from either cloud page when you skip its Utopia section.

The values you can set are in [`deploy/install`](../../deploy/install/README.md), including the table of Secrets you can create yourself.
