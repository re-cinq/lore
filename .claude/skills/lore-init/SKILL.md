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
