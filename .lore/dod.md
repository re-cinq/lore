# Definition of Done

> On 2026-08-29 the GHCR pull credential stopped working. Every pod created for the next ~9 hours could not start; running pods were unaffected because their images were already on-node. Nothing alerted.

**Strategy: `direct`** — The check script runs daily and exists explicitly to validate secrets, making it the perfect seam to add direct assertions against the content and validity of the secrets.

## Done when these pass

- [x] **check-secrets.sh catches an empty dockerconfigjson password** — Ensure the script detects and reports empty passwords in `.dockerconfigjson` secrets.
  `scripts/infra/check-secrets.test.mjs`

- [x] **check-secrets.sh catches an expired dockerconfigjson token via curl** — Ensure the script calls curl against the registry token endpoint and reports an expired token.
  `scripts/infra/check-secrets.test.mjs`

## Facets

- [x] Decode `.dockerconfigjson` from `kubernetes.io/dockerconfigjson` secrets managed by ESO
- [x] Assert `.auths` exists and names the expected registry
- [x] Assert `auth` value base64-decodes to a non-empty token
- [x] Exchange token via `curl` against registry endpoint and require HTTP 200

## Out of scope

- Moving to a machine user or org-internal packages
