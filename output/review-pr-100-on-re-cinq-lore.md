I need to read the PR first. Let me fetch it.

```bash
gh pr view 100 --repo re-cinq/lore --json title,body,files,commits
```

Once I have the PR details, I'll:

1. **Read the spec** — check `.specify/spec.md` for requirements
2. **Check conventions** — validate against `CLAUDE.md`, relevant ADRs, and existing code patterns
3. **Review code quality** — type safety, security, readability
4. **Post specific comments** — use `gh pr review` with actionable feedback
5. **Output the result** — `APPROVED` or `CHANGES_REQUESTED` with specifics

I'm ready to review. Can you run the fetch, or would you like me to proceed with a different approach?

(If you're running this in a real environment where `gh` is configured and authenticated, I can execute the command directly. Otherwise, paste the PR details and I'll review from there.)