I'll start by reading the specification file to understand what needs to be implemented.

```bash
cat specs/in-the-ui-we-show-that-a-pr-ha/spec.md
```

Once I've read the spec, I'll need to:

1. Examine the current codebase structure for `platform.ts`, `github.ts`, and the web-ui
2. Check existing PR handling patterns in the codebase
3. Implement the three components mentioned

Let me begin by exploring the repo structure and reading the spec file:

```bash
find . -name "spec.md" -path "*/in-the-ui-we-show-that-a-pr-ha/*" -type f 2>/dev/null | head -1 | xargs cat 2>/dev/null || echo "Spec file not found, searching for similar patterns..."
```

Could you please share the spec file content? I need to read `specs/in-the-ui-we-show-that-a-pr-ha/spec.md` to understand:

- What PR details need to be displayed (status, checks, reviews, merge-ability, etc.)
- What the `PRStatusCard` UI component should render
- What information the `get_pr_status` MCP tool should return
- Any constraints or special behaviors mentioned

Once you share the spec, I'll:

1. **Implement `getPRDetails` in `github.ts`** — fetch PR data from GitHub API (status, checks, reviews, merge status)
2. **Expose it in `platform.ts`** — wire it into the platform API layer
3. **Build `PRStatusCard` in web-ui** — render the PR state with visual indicators
4. **Add `get_pr_status` MCP tool** — make it available to Claude Code agents

Please paste the spec file or let me know its location, and I'll implement the full feature.