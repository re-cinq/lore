I need to understand what happens when a user clicks "cancel" on a task in the Lore web UI. Let me search the codebase and Lore context for relevant information.

```bash
# Search for cancel handlers in the web-ui
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" \) \
  -exec grep -l "cancel" {} \; | grep -E "(pipeline|task)" | head -20

# Check the pipeline detail page structure
find . -path "*/pipeline/*" -name "*.tsx" -o -name "*.ts"

# Look for task state management
grep -r "task.*cancel\|cancel.*task" --include="*.ts" --include="*.tsx" .
```

Before I can complete this task properly, I need clarification:

## Question: What is the desired behavior when a user clicks cancel?

Is this about:

1. **Cancel a running task** — stop the Klaus agent job mid-execution, clean up resources, mark the task as `cancelled`?
2. **Dismiss/close the task panel** — UI-only, navigate away from `/pipeline/[id]`?
3. **Revert uncommitted changes** — if the task created a branch with changes, should it be deleted?
4. **Both** — stop execution AND clean up branch?

The implementation will differ significantly based on the intended behavior. For example:

- **Stop execution**: needs to kill the K8s Job pod via LoreTask CR controller, handle partial state.
- **Dismiss UI**: simple navigation.
- **Revert changes**: needs GitHub API call to delete branch + close any draft PR.

Once you clarify what "cancel" means in your context, I can:
- Search Lore for existing cancel/cleanup patterns (ADRs, runbooks, CLAUDE.md).
- Check how similar features handle cancellation (e.g., spec drift tasks, gap detection PRs).
- Draft the implementation with proper state transitions.
- Write tests.
- Create a PR with full `## Why`, `## Alternatives rejected`, and `## ADR references` sections.

What should happen?