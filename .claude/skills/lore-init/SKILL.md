---
name: lore-init
description: Initialize Lore for a new organization. Sets up team structure, CLAUDE.md templates, CODEOWNERS, and optionally imports teams from GitHub.
---

Run the initialization script:

```bash
./scripts/lore-init.sh
```

This walks you through setting up Lore for your org. It creates the team
directory structure, skeleton CLAUDE.md files, CODEOWNERS, and optionally
your first ADR. It can import team names from your GitHub organization.

After init, fill in the skeleton files with your actual conventions, then
run install.sh to configure Claude Code.

## Help

<!-- lore-help:begin -->
**Summary.** Bootstrap Lore for a whole organisation — team directories, skeleton CLAUDE.md files, CODEOWNERS, optionally your first ADR.
**Usage:** `/lore-init`
**Use when.** Once, at the very start, before anyone runs `install.sh`. It sets up the org-level structure the rest of Lore reads from.
**Not for.** Adding a single repo to an existing Lore org — that is the `/onboard` page or `lore_onboard_repo`. Configuring your own machine — that is `scripts/install.sh`.
**Examples**
- `/lore-init` — runs `scripts/lore-init.sh`, which walks the setup and can import team names from your GitHub organisation
- After it finishes, fill in the skeleton `teams/*/CLAUDE.md` with real conventions — the skeletons are prompts, not content
**Related:** `/lore-agents`
<!-- lore-help:end -->
