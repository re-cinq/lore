# Contributing

## Getting Started

Run the install script once to set up your environment:

```bash
scripts/install.sh
```

This configures the MCP server, skills, hooks, and agent ID.

## Development Workflow

Use the `/lore-feature` skill to start or continue implementing a feature:

```
/lore-feature
```

It guides you through spec → plan → tasks → implementation interactively.

## Code Conventions

See [CLAUDE.md](CLAUDE.md) for full conventions. Quick summary:

- **TypeScript**: ESM modules, strict mode, Zod validation on MCP tools
- **Python**: glue scripts only, keep under 100 lines
- **Bash**: idempotent scripts, prefix output with `[lore]`
- No long-lived credentials — use Workload Identity or `gcloud auth`

## Submitting PRs

A PR template is included in `.github/pull_request_template.md`. Fill it out
before requesting review. Use the `/lore-pr` skill to draft a description from
your spec and changed files:

```
/lore-pr
```

PRs for implementation tasks are typically created automatically by the Lore
Agent. Human PRs follow the same template and conventions.
