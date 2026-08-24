---
adr_number: 45
title: "npm publishing convention for re:cinq product packages"
status: accepted
date: 2026-08-24
deciders: ["Loredana Moanga"]
domains: [build, ci, packaging, security]
---

# ADR-045: npm publishing convention for re:cinq product packages

Three repos in the current backlog must publish to npm exactly the way `@re-cinq/agent-contracts` already does — `@re-cinq/hal-engine`, `@re-cinq/bowman-ui`, and whatever `support-agent` ships. The convention exists as a worked implementation in `re-cinq/ai-agent-subsystem`, but org memory and context return nothing for npm scope, versioning, release tagging or trusted publishing. This ADR records the convention so each publishing issue copies it instead of re-deriving it; the decision content was settled by `agent-contracts` and is written down here, not re-opened.

## Decision

### Manifest contract

Every published re:cinq product package carries the manifest shape `packages/agent-contracts/package.json` has at 0.10.6:

- Name under the `@re-cinq` scope.
- `"license": "Apache-2.0"`.
- `"type": "module"` — ESM-only output.
- `"files": ["dist"]` — the tarball is `dist/` plus `package.json`, `LICENSE` and `README`.
- An `exports` map whose `"."` entry lists `types` before `default`.
- `publishConfig.access: "public"`.
- A `repository` object with `type`, `url` and `directory`.

### Release contract

Releases run from a GitHub Actions workflow with:

- `on: push: tags: ['v*']` plus `workflow_dispatch`.
- `permissions: contents: read` with `id-token: write`.
- `npm install -g npm@^11.5.1` before publishing — OIDC trusted publishing needs npm 11.5.1 or newer, and Node 22 ships an older npm.
- `npm publish --provenance --access public`.

### Auth is trusted publishing, never a token

Auth is npm Trusted Publishing over OIDC: a trusted publisher registered on npmjs.com for the package, pointing at the repo and the release workflow. **No `NPM_TOKEN` secret is used in the release workflow.**

### The version guard is mandatory

The release job fails, before publishing, when the git tag and the committed `package.json` version disagree. The reason is recorded history: `v0.5.0` through `v0.7.0` published nothing while npm sat on `0.3.0` for nine weeks, because npm's duplicate-version rejection reads like an auth failure and nobody looked (`ai-agent-subsystem/scripts/check-contracts-version.sh`, ai-agent-subsystem#139). The guard turns that silence into a red job that names the fix.

### First-publish caveat

A package name that has never been published cannot start with a trusted publisher — registration on npmjs.com requires the package to exist. The first publish is therefore done once with a short-lived token, after which the trusted publisher is registered and the token is revoked.

### PA-17 hardening is required on new workflows

Any new release workflow carries, from its first commit:

- `persist-credentials: false` on `actions/checkout`.
- `--ignore-scripts` on `npm ci`.
- `GITHUB_TOKEN` permissions scoped to the job.

The reference `publish-contracts.yml` does **not** carry this hardening today, so a copy of that file is a starting point rather than a finished one.

### Actions pinned by commit SHA

Third-party actions are pinned by full commit SHA with a version comment, as `publish-contracts.yml` pins `actions/checkout` and `actions/setup-node`.

## Reference implementation

The worked implementation this ADR cites rather than restates:

- `ai-agent-subsystem/packages/agent-contracts/package.json` (`@re-cinq/agent-contracts` 0.10.6)
- `ai-agent-subsystem/.github/workflows/publish-contracts.yml` (with the PA-17 caveat above)
- `ai-agent-subsystem/scripts/check-contracts-version.sh`

## Recorded exception: private repos publish without provenance

npm provenance attestation requires a public source repository. `re-cinq/bowman-ui` was decided private at scaffold time (decider: Loredana Moanga, 2026-08-24), so its release workflow omits `--provenance` and carries a comment naming that decision. Everything else in this convention still applies to it. If the repo is later made public, `--provenance` is restored in the same PR that flips visibility, and this exception paragraph shrinks to a historical note.

## What this ADR does not decide

Publishing private npm packages (restricted registry access — distinct from the private-source-repo exception above, which still publishes publicly), prerelease versions and dist-tags, and publishing more than one package from one repo. A repo that needs any of these opens a new decision rather than stretching this one.
