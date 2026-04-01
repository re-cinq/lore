I'll review PR #87 on re-cinq/lore. Let me start by gathering the necessary context.

```bash
gh pr view 87 --repo re-cinq/lore --json title,body,files,commits,reviews
```

```bash
gh pr diff 87 --repo re-cinq/lore
```

```bash
cat .specify/spec.md
cat CLAUDE.md
ls -la adrs/
```

I need to actually see the PR to review it. However, I notice this is a context instruction rather than an actual PR number I can access in real-time.

**Let me clarify:** I'm Claude in a context document. I don't have real-time access to:
- Your GitHub repositories
- The actual PR #87
- Live git diffs or file contents
- The ability to run `gh` CLI commands

## What I can do instead:

If you're **asking me to review a real PR**, please:

1. **Paste the PR description** (title + body)
2. **Paste the diff** (`git diff` output or `gh pr diff` output)
3. **Confirm the relevant spec/CLAUDE.md files** you want me to check against
4. **Point me to any specific ADRs** that apply

Then I can provide a thorough review with specific comments and output either:
```
REVIEW_RESULT:APPROVED
```
or
```
REVIEW_RESULT:CHANGES_REQUESTED:<feedback>
```

**Or** — if you're asking me to **act as a review agent in the Lore system** — I'd need to be deployed as a Klaus agent with:
- Access to the GitHub API (via `gh` CLI or octokit)
- Access to the repository files
- Ability to post review comments

Would you like to:
- **A)** Paste a PR diff for me to review now?
- **B)** Deploy me as a Klaus review agent (which would require the LoreTask CR setup)?
- **C)** Something else?