#!/usr/bin/env node
// Does nothing and exits 0. Re-anchoring moved into `re-lint/no-stale-spec-links`, which `eslint --fix` runs — so `npm run format` and the CI `format` job heal the anchors. The file stays because agent recipes (and the migrations that seeded them) still run `node scripts/spec-links/reanchor.mjs` after the formatter.
