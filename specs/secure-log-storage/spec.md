# Feature Specification: Secure Persistent Log Storage

| Field          | Value                                    |
|----------------|------------------------------------------|
| Feature        | Secure Persistent Log Storage            |
| Branch         | feat/secure-logs                         |
| Status         | Shipped                                  |
| Created        | 2026-04-02                               |
| Owner          | Platform Engineering                     |
| Target         | 1 week                                   |

## Problem Statement

Agent task logs (Claude Code output) contain sensitive data:
- File contents from target repos (may include credentials, API keys)
- Environment variable values printed in error traces
- Internal code patterns, security configurations
- Database schemas, connection strings

Currently logs are either ephemeral (K8s pod logs, lost after 5 min)
or dumped raw into `task_events` (no access control, no redaction,
no encryption, indefinite retention). Neither is acceptable for a
product used across teams and repos with different access levels.

## Requirements

1. **Persistent** — logs survive pod cleanup, available for debugging
   hours/days after task completion
2. **Access-controlled** — users only see logs for repos they have
   access to (verified via GitHub API)
3. **Redacted** — secrets, tokens, and credentials stripped before
   storage
4. **Encrypted at rest** — logs stored encrypted, decrypted on read
5. **Retention policy** — auto-delete after configurable TTL
6. **Streamable** — live logs during execution, not just after
7. **Auditable** — log access is itself logged

## Architecture

### Storage: GCS Bucket with Encryption

```
Job Pod (claude-runner)
  │ stdout/stderr
  ▼
Controller reads pod logs
  │
  ▼
Redaction pipeline (strip secrets)
  │
  ▼
GCS: gs://lore-task-logs/{repo}/{task-id}/output.log
  │ (encrypted with CMEK, lifecycle: 30 days)
  │
  ▼
Web UI reads via API route
  │ (checks GitHub repo access first)
  ▼
Developer sees redacted logs
```

### Components

**1. Log Collector (controller)**

The controller writes logs to GCS during `checkJob()`:
- While Job is Running: read pod logs, redact, write to GCS every 15s
- On completion: final write with full output
- GCS object key: `{repo}/{task-id}/{timestamp}.log`

```typescript
async function persistLogs(taskId: string, repo: string, logs: string): Promise<void> {
  const redacted = redactSecrets(logs);
  const bucket = storage.bucket("lore-task-logs");
  const file = bucket.file(`${repo}/${taskId}/output.log`);
  await file.save(redacted, { resumable: false });
}
```

**2. Secret Redaction**

A redaction pipeline that strips:
- Environment variable assignments (`export VAR=value`, `VAR=value`)
- Common secret patterns:
  - API keys (sk-*, ghp_*, ghs_*, AKIA*, xoxb-*)
  - JWT tokens (eyJ*)
  - Private keys (-----BEGIN.*PRIVATE KEY-----)
  - Connection strings (postgres://, mysql://, mongodb://)
  - Base64-encoded blobs > 100 chars
- Custom patterns from repo settings (`lore.repos.settings.redact_patterns`)

Redaction replaces matches with `[REDACTED:type]` (e.g., `[REDACTED:api-key]`).

```typescript
function redactSecrets(text: string): string {
  const patterns = [
    { name: "api-key", re: /(?:sk-|ghp_|ghs_|AKIA|xoxb-)[A-Za-z0-9_-]{20,}/g },
    { name: "jwt", re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g },
    { name: "private-key", re: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g },
    { name: "connection-string", re: /(?:postgres|mysql|mongodb|redis):\/\/[^\s"']+/g },
    { name: "env-assignment", re: /(?:export\s+)?[A-Z_]{3,}=(?:'[^']*'|"[^"]*"|[^\s]+)/g },
    { name: "base64-blob", re: /[A-Za-z0-9+/]{100,}={0,2}/g },
  ];
  let result = text;
  for (const p of patterns) {
    result = result.replace(p.re, `[REDACTED:${p.name}]`);
  }
  return result;
}
```

**3. GCS Bucket Configuration**

```hcl
resource "google_storage_bucket" "task_logs" {
  name          = "lore-task-logs-${var.project_id}"
  location      = var.region
  storage_class = "STANDARD"

  lifecycle_rule {
    condition { age = 30 }       # 30-day retention
    action { type = "Delete" }
  }

  encryption {
    default_kms_key_name = google_kms_crypto_key.logs.id
  }

  uniform_bucket_level_access = true
}

resource "google_kms_key_ring" "lore" {
  name     = "lore"
  location = var.region
}

resource "google_kms_crypto_key" "logs" {
  name            = "task-logs"
  key_ring        = google_kms_key_ring.lore.id
  rotation_period = "7776000s"  # 90 days
}
```

**4. Access Control (API Route)**

The web-ui API route verifies repo access before returning logs:

```typescript
// GET /api/pipeline/[id]/logs
async function GET(req, { params }) {
  const session = await getServerSession();
  if (!session) return 401;

  const task = await getTask(params.id);

  // Check: does this user have access to task.target_repo?
  const hasAccess = await checkGitHubRepoAccess(
    session.accessToken, task.target_repo
  );
  if (!hasAccess) return 403;

  // Read from GCS
  const logs = await readLogsFromGCS(task.target_repo, task.id);
  return Response.json({ logs, status: task.status });
}

async function checkGitHubRepoAccess(token: string, repo: string): Promise<boolean> {
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok; // 200 = has access, 404 = no access
}
```

**5. Live Streaming**

During execution, the API route reads from GCS (updated every 15s
by the controller). The `?since=` param enables incremental reads:

```
Client polls /api/pipeline/{id}/logs?since=<offset>
  → API checks access
  → Reads from GCS with range header (offset to end)
  → Returns new bytes since last poll
```

After completion, the full log is a single GCS read.

**6. Audit Trail**

Every log access is recorded:
```sql
INSERT INTO pipeline.log_access (task_id, user_id, accessed_at, ip_address)
VALUES ($1, $2, now(), $3);
```

**7. Pipeline DB Changes**

Add to `pipeline.tasks`:
```sql
ALTER TABLE pipeline.tasks ADD COLUMN log_url TEXT;
-- GCS URL: gs://lore-task-logs/{repo}/{task-id}/output.log
```

Remove: no more log entries in `task_events` (`to_status = 'log'`).

### Data Flow Summary

| Stage | Where | Duration | Access |
|-------|-------|----------|--------|
| Live (running) | GCS object, updated every 15s | While pod runs | Authenticated + repo access |
| Completed | GCS object, final write | 30 days (configurable) | Authenticated + repo access |
| Pod logs | K8s (raw, unredacted) | 5 min after Job TTL | kubectl only (platform eng) |
| Audit | pipeline.log_access table | Indefinite | Platform eng |

## File Changes

| File | Change |
|------|--------|
| `agent/src/loretask-controller.ts` | Write redacted logs to GCS on poll + completion |
| `agent/src/lib/redact.ts` | New: secret redaction pipeline |
| `agent/src/lib/log-storage.ts` | New: GCS read/write for task logs |
| `web-ui/src/app/api/pipeline/[id]/logs/route.ts` | Rewrite: read from GCS, check repo access |
| `web-ui/src/app/pipeline/[id]/TaskLogs.tsx` | Update: handle access denied, show redaction notices |
| `terraform/logs.tf` | New: GCS bucket, KMS key, IAM for controller SA |
| `terraform/variables.tf` | Add: log_retention_days variable |
| `scripts/infra/setup-pipeline-schema.sh` | Add: log_access audit table, log_url column |

## Out of Scope

1. **Log search** — no full-text search across logs (GCS isn't a search engine)
2. **Log aggregation** — no Loki/Elasticsearch. GCS is sufficient for per-task logs
3. **Real-time WebSocket** — polling every 5s is acceptable
4. **Custom retention per repo** — global 30-day default only
5. **Log export** — no download button (copy from terminal view)

## Security Model

| Threat | Mitigation |
|--------|-----------|
| Secrets in logs | Redaction pipeline strips known patterns before storage |
| Unauthorized log access | GitHub repo access check per request |
| Data at rest exposure | CMEK encryption on GCS bucket |
| Log tampering | GCS object versioning + bucket-level uniform access |
| Access enumeration | Audit trail on every log read |
| Retention creep | GCS lifecycle rule auto-deletes after 30 days |
| Controller compromise | Controller SA has write-only to logs bucket, no read |

## Acceptance Criteria

1. Logs persist in GCS after pod cleanup
2. Secrets redacted before storage (API keys, JWTs, private keys, connection strings)
3. Users only see logs for repos they have GitHub access to
4. 403 returned for unauthorized log access
5. Logs encrypted at rest with CMEK
6. Auto-deleted after 30 days
7. Live logs update every 15s during execution
8. Log access audited in `pipeline.log_access` table
9. No raw logs stored in `task_events` or any DB table
