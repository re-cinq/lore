I'll review PR #80 on re-cinq/lore. Let me start by fetching the PR details and understanding what's being changed.

```bash
gh pr view 80 --json title,body,files,commits
```

Once I have the PR context, I'll check it against:
1. The spec files in the `specs/` directory
2. Conventions in `CLAUDE.md` and ADRs in `adrs/`
3. Code quality, type safety, security

However, I notice you've provided the **constitution and system prompts** for the Lore platform, but I need the actual PR #80 details to perform the review. 

Could you provide:
- The PR title and description
- The list of changed files
- The actual code diff (or key sections of it)

Or, if you have GitHub CLI access, run:
```bash
gh pr view 80 --web
```
and share the PR details, or run:
```bash
gh pr diff 80
```
to get the full diff.

Once I have the PR content, I'll systematically review it against the constitution (Principle 3 on PR description quality, Principle 6 on distributed ownership and CI eval gates, the tech stack, and the phased delivery requirements) and output either:

- `REVIEW_RESULT:APPROVED`
- `REVIEW_RESULT:CHANGES_REQUESTED:<specific actionable feedback>`