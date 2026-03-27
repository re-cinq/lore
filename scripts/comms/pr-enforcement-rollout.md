# PR Description Enforcement — Rollout Announcement

> Copy-paste into #engineering Slack or send via email. Edit the placeholders in `[brackets]`.

---

**Subject: PR descriptions are getting enforced — here's what you need to know**

Hey team,

Starting `[DATE]`, we're enforcing structure in PR descriptions. Here's the short version.

**What's changing**

PR descriptions now require two sections:

- **Why** — What problem does this solve? Why now?
- **Alternatives Rejected** — What else did you consider, and why did you pick this approach?

A CI check will validate that both sections are present and filled in.

**Why we're doing this**

PR descriptions feed into Lore. Lore uses them to build context that Claude Code relies on when working in our repos. Thin descriptions = Claude working with incomplete information = worse suggestions for everyone. Better descriptions make the whole system smarter.

**Timeline**

- **Weeks 1-2 (`[START]` to `[END]`):** Warning mode. The check runs but won't block merge. You'll see a warning comment on your PR if sections are missing.
- **After week 2:** Hard fail. PRs missing required sections won't pass CI. The platform team flips this manually once we're confident the warnings have been seen.

**What you need to do**

Fill out both sections in every PR. Some specifics:

- "N/A" does not count for Alternatives Rejected. Even if you didn't seriously consider anything else, write something like: "Considered using a cron job but chose an event-driven approach because it avoids polling and reduces latency."
- One or two sentences is fine. We're not looking for essays.
- If it's a truly trivial change (typo fix, dependency bump), say so: "No alternatives — this is a direct fix for a typo in the README."

**Examples**

- `[LINK TO EXAMPLE PR 1]` — good "Why" section
- `[LINK TO EXAMPLE PR 2]` — good "Alternatives Rejected" section

**Questions or issues?**

Tag @platform-eng in #engineering or DM anyone on the platform team. We'll sort it out.

---
