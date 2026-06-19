# Try the Agent/Station/AgentDefinition subsystem locally

Runs the whole thing end-to-end on a local cluster — no cloud, no Lore backend.
You'll create an `Agent` and watch the controller turn it into a real Kubernetes
Job that finishes. The subsystem is cluster-agnostic: **minikube** and **kind**
both work (it targets whatever your current `kubectl` context is). Background on
the concepts: ../README.md and ADR-031.

Prerequisites: `kubectl`, plus **minikube** (or kind).

## 1. Start a local cluster

```bash
minikube start            # or:  kind create cluster --config k8s/local/kind.yaml
```

## 2. Install the subsystem (CRDs + permissions + controller)

```bash
kubectl apply -k k8s
```

This registers the three resource kinds, the RBAC, the NetworkPolicy, and the
controller Deployment. The controller image isn't published yet, so for local dev
run the controller **on your machine** against the cluster — fastest, no image needed:

```bash
kubectl -n lore-agents scale deploy/agent-controller --replicas=0   # avoid an unpullable in-cluster pod
cd k8s/controller && npm install && npm run build
NAMESPACE=lore-agents HEALTH_PORT=8092 node dist/main.js             # uses your kubeconfig (minikube/kind)
```

> To run it **in** the cluster instead: build the image and load it —
> minikube: `minikube image build -t lore-agent-controller:dev k8s/controller`
> (or `docker build -t lore-agent-controller:dev k8s/controller && minikube image load lore-agent-controller:dev`);
> kind: `docker build -t lore-agent-controller:dev k8s/controller && kind load docker-image lore-agent-controller:dev`.
> Then set the Deployment image to `lore-agent-controller:dev` and scale it back to 1.

## 3. Define a recipe + a Station (once)

```bash
kubectl apply -f k8s/examples/agentdefinition-implementation.yaml
kubectl apply -f k8s/examples/station-default.yaml
```

## 4. Start a run, and watch it

Note `kubectl create` (not `apply`) — the sample uses `generateName` for a unique run id:

```bash
kubectl create -f k8s/examples/agent-sample.yaml
kubectl -n lore-agents get agents -w
```

You should see `Pending → Running → Succeeded`. Inspect it:

```bash
kubectl -n lore-agents get agents
# NAME                  PHASE       STATION      REPO           AGE
# bug-fixer-run-7g2k9   Succeeded   node-fixer   re-cinq/lore   30s

kubectl -n lore-agents get agent <name> -o jsonpath='{.status.output}'
# [agent] prompt: Fix the bug described in ENG-417 on repo re-cinq/lore, branch fix/login-eng-417...
```

The rendered prompt in `status.output` confirms the Agent's `parameters` filled the
recipe's `{placeholders}`. The Job auto-deletes ~5 min after finishing
(`ttlSecondsAfterFinished`); the Agent record stays until pruned past the Station's
history limits.

## 5. Prove validation is enforced by Kubernetes

```bash
kubectl -n lore-agents create -f - <<'EOF'
apiVersion: lore.re-cinq.com/v1alpha1
kind: Agent
metadata: { generateName: bad- }
spec: {}            # missing required stationRef
EOF
# -> rejected by the CRD schema (spec.stationRef required), not by our code.
```

## Tear down

```bash
kubectl delete -k k8s        # remove the subsystem
minikube delete              # or:  kind delete cluster --name lore-agents
```
