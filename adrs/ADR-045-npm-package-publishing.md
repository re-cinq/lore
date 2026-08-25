---
adr_number: 45
title: "npm publishing convention for re:cinq product packages"
status: accepted
date: 2026-08-24
deciders: ["Loredana Moanga"]
domains: [build, ci, packaging, security]
---

# ADR-045: npm publishing convention for re:cinq product packages

This ADR records the npm publishing convention for re:cinq product packages — manifest shape, release trigger, tokenless auth, the version guard, and the first-publish caveat — so that each new package repo copies it instead of re-deriving it.

## Context

Three repos in the current backlog must publish to npm exactly the way `@re-cinq/agent-contracts` already does — `@re-cinq/hal-engine`, `@re-cinq/bowman-ui`, and whatever `support-agent` ships. The convention exists as a worked implementation in `re-cinq/ai-agent-subsystem`, but org memory and context return nothing for npm scope, versioning, release tagging or trusted publishing. Left unrecorded, each publishing issue re-derives the convention by hand and the third invents something new. The decision content was settled by `agent-contracts`; this ADR writes it down rather than re-opening it.

The reference implementation is:

- `ai-agent-subsystem/packages/agent-contracts/package.json` (`@re-cinq/agent-contracts` 0.10.6)
- `ai-agent-subsystem/.github/workflows/publish-contracts.yml`
- `ai-agent-subsystem/scripts/check-contracts-version.sh`

One caveat applies to the reference: `publish-contracts.yml` predates the org's PA-17 hardening, so a copy of that file is a starting point rather than a finished one (see Consequences).

## Decision

See the Consequences section below — the terms `agent-contracts` already implements become the binding convention for every `@re-cinq` product package, with the PA-17 hardening required on top.

## Consequences

### Consequences for the package manifest

Every published re:cinq product package carries the manifest shape `packages/agent-contracts/package.json` has at 0.10.6:

- Name under the `@re-cinq` scope.
- `"license": "Apache-2.0"`.
- `"type": "module"` — ESM-only output.
- `"files": ["dist"]` — the tarball is `dist/` plus `package.json`, `LICENSE` and `README`.
- An `exports` map whose `"."` entry lists `types` before `default`.
- `publishConfig.access: "public"`.
- A `repository` object with `type`, `url` and `directory` (single-package repos omit `directory`).

### Consequences for the release workflow

Releases run from a GitHub Actions workflow with:

- `on: push: tags: ['v*']` plus `workflow_dispatch`.
- `permissions: contents: read` with `id-token: write`.
- `npm install -g npm@^11.5.1` before publishing — OIDC trusted publishing needs npm 11.5.1 or newer, and Node 22 ships an older npm.
- `npm publish --provenance --access public`.

### Consequences for auth

Auth is npm Trusted Publishing over OIDC: a trusted publisher registered on npmjs.com for the package, pointing at the repo and the release workflow. No `NPM_TOKEN` secret is used in the release workflow.

### Consequences: the version guard

The release job fails, before publishing, when the git tag and the committed `package.json` version disagree. The reason is recorded history: `v0.5.0` through `v0.7.0` published nothing while npm sat on `0.3.0` for nine weeks, because npm's duplicate-version rejection reads like an auth failure and nobody looked (`ai-agent-subsystem/scripts/check-contracts-version.sh`, ai-agent-subsystem#139). The guard turns that silence into a red job that names the fix.

### Consequences: the first publish

A package name that has never been published cannot start with a trusted publisher — registration on npmjs.com requires the package to exist. The first publish is therefore done once with a short-lived token, after which the trusted publisher is registered and the token is revoked.

### Consequences: hardening on new workflows

Any new release workflow carries, from its first commit:

- `persist-credentials: false` on `actions/checkout`.
- `--ignore-scripts` on `npm ci`.
- `GITHUB_TOKEN` permissions scoped to the job.

The reference `publish-contracts.yml` does not carry this hardening today; new workflows are required to, and copies of the reference must add it.

### Consequences: action pinning

Third-party actions are pinned by full commit SHA with a version comment, as `publish-contracts.yml` pins `actions/checkout` and `actions/setup-node`.

### Consequences for private-source repos

npm provenance attestation requires a public source repository. `re-cinq/bowman-ui` was decided private at scaffold time (decider: Loredana Moanga, 2026-08-24), so its release workflow omits `--provenance` and carries a comment naming that decision. Everything else in this convention still applies to it. If the repo is later made public, `--provenance` is restored in the same PR that flips visibility, and this exception paragraph shrinks to a historical note.

Downstream repos (`hal-engine`, `bowman-ui`, `support-agent`) copy the manifest shape and workflow from the reference implementation rather than deriving them independently. The version guard converts npm's duplicate-version silent rejection into a named, fixable CI failure. New workflows ship with PA-17 hardening from the first commit rather than accruing it later under incident pressure.

## Out of scope

Publishing private npm packages (restricted registry access — distinct from the private-source-repo exception above, which still publishes publicly), prerelease versions and dist-tags, and publishing more than one package from one repo. A repo that needs any of these opens a new decision rather than stretching this one.
