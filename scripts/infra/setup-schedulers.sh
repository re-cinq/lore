#!/usr/bin/env bash
set -euo pipefail

PROJECT="re5-n8n-platform"
REGION="europe-west1"

# The MCP server endpoint inside the cluster.
# Cloud Scheduler can't reach ClusterIP directly — we need to either:
# 1. Use a GKE internal ingress
# 2. Use a CronJob inside the cluster instead
#
# For now, use Kubernetes CronJobs (simpler, no ingress needed).

echo "[lore] Setting up scheduled jobs..."

# 1. Nightly full re-index (2am UTC)
kubectl apply -f - <<'EOF'
apiVersion: batch/v1
kind: CronJob
metadata:
  name: lore-nightly-reindex
  namespace: klaus
spec:
  schedule: "0 2 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: trigger
            image: curlimages/curl:latest
            command:
            - /bin/sh
            - -c
            - |
              curl -sf -X POST http://lore-mcp.mcp-servers.svc.cluster.local:3000/mcp \
                -H 'Content-Type: application/json' \
                -d '{
                  "jsonrpc": "2.0",
                  "id": 1,
                  "method": "tools/call",
                  "params": {
                    "name": "delegate_task",
                    "arguments": {
                      "task": "Run full nightly re-index. Ingest all PRs, ADRs, docs, specs, and runbooks. Hard-delete chunks whose source no longer exists.",
                      "context": { "branch": "main" },
                      "priority": "normal"
                    }
                  }
                }'
          restartPolicy: OnFailure
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
EOF

# 2. Weekly gap detection (Monday 9am UTC)
kubectl apply -f - <<'EOF'
apiVersion: batch/v1
kind: CronJob
metadata:
  name: lore-weekly-gap-detection
  namespace: klaus
spec:
  schedule: "0 9 * * 1"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: trigger
            image: curlimages/curl:latest
            command:
            - /bin/sh
            - -c
            - |
              curl -sf -X POST http://lore-mcp.mcp-servers.svc.cluster.local:3000/mcp \
                -H 'Content-Type: application/json' \
                -d '{
                  "jsonrpc": "2.0",
                  "id": 1,
                  "method": "tools/call",
                  "params": {
                    "name": "delegate_task",
                    "arguments": {
                      "task": "Run weekly gap detection. Query Cloud Monitoring for low-confidence retrievals from the past 7 days. For each gap cluster with 3+ occurrences, draft the missing content and open a PR to the context repo.",
                      "context": { "seed_query": "context gaps low confidence retrieval" },
                      "priority": "low"
                    }
                  }
                }'
          restartPolicy: OnFailure
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
EOF

# 3. Weekly spec drift check (Monday 10am UTC)
kubectl apply -f - <<'EOF'
apiVersion: batch/v1
kind: CronJob
metadata:
  name: lore-weekly-spec-drift
  namespace: klaus
spec:
  schedule: "0 10 * * 1"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: trigger
            image: curlimages/curl:latest
            command:
            - /bin/sh
            - -c
            - |
              curl -sf -X POST http://lore-mcp.mcp-servers.svc.cluster.local:3000/mcp \
                -H 'Content-Type: application/json' \
                -d '{
                  "jsonrpc": "2.0",
                  "id": 1,
                  "method": "tools/call",
                  "params": {
                    "name": "delegate_task",
                    "arguments": {
                      "task": "Run weekly spec drift detection. Read spec files, check assertions against current code via AST analysis. Create Beads tasks for specs with >20% divergence.",
                      "priority": "low"
                    }
                  }
                }'
          restartPolicy: OnFailure
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
EOF

echo ""
echo "[lore] Scheduled jobs created:"
kubectl get cronjobs -n klaus
