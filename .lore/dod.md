# Definition of Done

> IFS= read -rs value accepts one PEM line and can spill subsequent lines into the next secrets.

**Strategy: `direct`** — The `seed-secrets.sh` script can be executed directly as a child process, with `gcloud` stubbed to observe the seeded values and verify multiline handling.

## Done when these pass

- [ ] **A multi-line GitHub App PEM is stored whole and cannot become values for subsequent secrets** — The script reads full multiline input for a secret and does not let remaining lines pollute subsequent secrets.
  `scripts/infra/seed-secrets.acceptance.test.mjs`

## Facets

- [ ] Fix `seed-secrets.sh` to read multiline inputs correctly instead of using `IFS= read -rs value`.

## Out of scope

- Operational checks of running pods or deployments.
- Terraform changes for secret containers.