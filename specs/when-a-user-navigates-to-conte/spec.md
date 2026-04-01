# Feature Specification: File Viewer — Context Navigation and Expansion

| Field             | Value                                      |
|-------------------|--------------------------------------------|
| Feature           | File Viewer with GitHub Navigation & Expansion |
| Branch            | file-viewer-github-nav                     |
| Status            | Draft                                      |
| Created           | 2026-03-25                                 |
| Owner             | Platform Engineering                       |
| Phase 0 Target    | 2-3 working days                           |
| Full Stack Target | 1-2 weeks                                  |

## Problem Statement

When developers navigate to the Context view in Claude Code and browse files listed from org context (CLAUDE.md, ADRs, specs), they see only a limited preview of each file. This creates friction:

1. **Truncated previews hide critical information** — developers can't see the full file content inline and must manually open GitHub in a browser to understand the complete context.

2. **No expand-in-place option** — unlike GitHub's native file viewer, there's no way to expand files directly in the context view, forcing context switches.

3. **Slower context loading** — developers must leave Claude Code, navigate to GitHub, find the file, then return to Claude Code to reference it.

4. **Inconsistent with GitHub UX** — developers expect familiar patterns (expand icon, clickable titles) that aren't present in the current Lore context viewer.

These friction points slow onboarding and reduce the utility of org context as a reference tool.

## Vision

The Context view in Claude Code displays file previews with two affordances:
1. **Clickable file title** — click the filename to navigate directly to the file on GitHub (opens in new tab)
2. **Expand icon** — click to toggle full file content inline, exactly like GitHub's file viewer

This requires no browser context switch and matches GitHub's familiar interaction model.

## User Personas

### New Developer (Day 1)

A developer onboarding to the org. They open Claude Code, see org context files (CLAUDE.md, ADRs), and want to quickly read full content without leaving the editor. They expect file expansion to work like GitHub.

### Active Developer (Daily Use)

A developer referencing org conventions mid-task. They search context, get file previews, and occasionally need to read a full file inline. The expand button saves them a browser tab switch.

### Technical Lead

Reviews org context quality and wants to verify that developers are seeing complete, up-to-date files — not truncated previews that miss critical details.

## User Scenarios & Acceptance Criteria

### Scenario 1: Expand File Inline

**Actor:** New Developer

**Flow:**
1. Developer opens Claude Code and types: `show me the org auth conventions`
2. Claude calls `search_context` → returns preview of `adrs/ADR-002-auth-strategy.md` (first 300 chars)
3. Developer sees the filename with a clickable expand icon (▶)
4. Developer clicks the expand icon
5. The file content expands inline, showing the full file
6. Developer clicks the icon again to collapse

**Acceptance Criteria:**
- Expand icon appears next to all file previews in context search results
- Clicking expand loads the full file content from the context store
- Content expands/collapses smoothly without page reload
- Collapse is immediate; expand completes within 500ms
- Works for files up to 50KB without truncation
- Icon state (expanded/collapsed) is tracked per file during the session

### Scenario 2: Navigate to GitHub

**Actor:** Active Developer

**Flow:**
1. Developer searches context and sees a preview of `CLAUDE.md`
2. Developer clicks the filename (appears as a link in blue)
3. A new browser tab opens to the file on GitHub (e.g., `github.com/re-cinq/lore/blob/main/CLAUDE.md`)
4. Developer can review the file on GitHub, copy lines, check git history, or create an issue

**Acceptance Criteria:**
- File title is always clickable (underlined, blue, cursor changes to pointer)
- Click opens `https://github.com/{owner}/{repo}/blob/{branch}/{filepath}`
- Branch defaults to `main`; respects repo's configured default if different
- Opens in a new tab (does not close Claude Code)
- Works for all file types (markdown, yaml, json, code, etc.)
- URL is correct for files in nested directories (paths with `/` are preserved)

### Scenario 3: Expand Multiple Files

**Actor:** Technical Lead

**Flow:**
1. Developer searches for "authentication" in context
2. Results show 3 files: ADR, spec, and CLAUDE.md excerpt
3. Developer expands the ADR to read the full decision
4. Developer then expands the spec to see requirements
5. Developer collapses the ADR, keeps the spec expanded
6. Developer navigates to GitHub on the spec by clicking its title

**Acceptance Criteria:**
- Multiple files can be expanded simultaneously
- Collapsing one file does not affect others
- Expand/collapse state is independent per file
- All files remain searchable and readable when expanded
- No layout shift or scrolling lag when expanding large files

## Functional Requirements

1. **File Preview Display** — Context search results display file name, path, and first 300 characters of content (or configurable limit). Mark truncated files with `…`

2. **Expand/Collapse Toggle** — Each file preview displays a clickable icon (▶ when collapsed, ▼ when expanded) to the left of or above the filename. Icon color: `#666` (neutral gray), hover: `#000` (dark).

3. **Full Content Retrieval** — Clicking expand calls `get_file_content` MCP tool (new tool, see Key Entities) to fetch the full file from the context store. Display full content in a scrollable container.

4. **GitHub Navigation Link** — File title is a clickable link styled like GitHub (blue `#0969da`, underlined on hover). Resolves repo name and branch from the context (git remote) and constructs the GitHub URL: `https://github.com/{owner}/{repo}/blob/{branch}/{filepath}`.

5. **State Persistence Per Session** — Track expand/collapse state per file (keyed by filepath + repo). When the same file appears in a second search result, remember its previous state. Clear state on new conversation.

6. **Performance** — Expand loads content within 500ms for files ≤50KB. Files >50KB must show a warning (`File exceeds 50KB; may load slowly. Continue?`) with a Cancel button.

7. **Error Handling** — If file fails to load, display: `Failed to load file. Try again?` with a retry button. Log error to console with filepath and error details.

8. **Accessibility** — Expand/collapse icon must be keyboard accessible (Tab to focus, Enter/Space to toggle). Title link must have `aria-label="Open {filename} on GitHub"`.

## Non-Functional Requirements

### Performance

- Expand toggle completes in <100ms (local state update)
- Full content fetch completes in <500ms for files ≤50KB
- Context search results render with expand/collapse icons in <50ms
- No layout shift when expanding (reserve space for expand icon)

### Accessibility

- Icon must have an `aria-label` describing the action
- Title link must be keyboard focusable and have appropriate ARIA labels
- Color contrast of expand icon against background must be ≥4.5:1 (WCAG AA)
- Expand/collapse must work via keyboard (Enter/Space on focused icon)

### Browser Compatibility

- All Chromium-based browsers (Chrome, Edge, VS Code)
- Safari 15+
- Firefox 90+

### Security

- GitHub URLs must use the repo's configured remote origin (prevent URL injection)
- File content must not be cached in localStorage (sensitive files)
- Content must respect any row-level access controls from the context store (check ACL before displaying)

## Out of Scope

1. **Syntax highlighting** — Full file content displays as plain text, not colored code. Syntax highlighting can be added in a follow-up phase.

2. **Line numbers** — Not included in this phase. Can be added later if needed.

3. **Search within expanded file** — Ctrl+F within the expanded content is handled by the browser, not custom UI.

4. **File diff comparison** — No side-by-side diff with other files or versions.

5. **Raw download** — No button to download the file. Use GitHub for that.

6. **Rename or edit files from Claude Code** — File viewer is read-only.

7. **GitHub authentication flow** — Assumes developer already has GitHub in their browser. Link opens in new tab; they use existing session or log in as needed.

8. **Real-time sync** — If a file is updated on GitHub, the expanded view does not auto-refresh. Requires a new search or manual refresh.

## Key Entities

### New MCP Tool: `get_file_content`

**Purpose:** Fetch full content of a file from the context store. Used when user expands a previewed file.

**Input:**
```json
{
  "repo": "re-cinq/lore",           // "owner/repo"
  "filepath": "CLAUDE.md",           // file path relative to repo root
  "branch": "main"                   // git branch (optional, defaults to main)
}
```

**Output:**
```json
{
  "filepath": "CLAUDE.md",
  "content": "# Lore\n\nShared context...",  // full file content
  "size_bytes": 12345,
  "encoding": "utf-8"
}
```

**Errors:**
- `404: File not found` — filepath does not exist in context store
- `403: Access denied` — user lacks permission to read this file (row-level ACL)
- `413: File too large` — file exceeds 1MB (return error, not content)

### Data Model Changes

**UI State (ephemeral, session-scoped):**
```typescript
interface FileViewerState {
  expandedFiles: Map<string, {
    filepath: string;
    repo: string;
    isExpanded: boolean;
    content?: string;
    loadingError?: string;
    loadTime?: number;
  }>;
}
```

**No database changes required** — state lives in Claude Code's session context.

## Success Criteria

1. **Adoption** — Within 2 weeks of ship, >50% of context search results in Claude Code show expand icons. Expand is clicked on >30% of displayed file previews (telemetry via MCP calls to `get_file_content`).

2. **Engagement** — Average time spent in context view increases by >20% (measured via session telemetry).

3. **Friction reduction** — Developers report in surveys that reading full files is "much easier" (vs. "requires switching to GitHub").

4. **Performance** — Expand toggle completes in <100ms. File content fetch completes in <500ms for 95% of files ≤50KB.

5. **Quality** — Zero crashes or infinite loops when expanding files. Error rate on `get_file_content` calls <1%.

## Assumptions

1. **MCP server has file access** — The context store (PostgreSQL) already contains full file content. The `search_context` tool can fetch it on demand.

2. **Git remote is available** — Claude Code can resolve the repo name from the git remote to construct GitHub URLs. Fallback: use `GITHUB_REPOSITORY` env if available.

3. **Developer has GitHub session** — Clicking a GitHub link opens in a new tab where the developer is already logged in. If not, GitHub's login flow handles it.

4. **No sensitive data concerns** — Files stored in the context are safe to display in Claude Code's UI. ACL checks happen at the database level (not client-side).

5. **File size limits** — Most files in org context are <50KB. Files >50KB are rare and can be loaded with a warning.

6. **Session scope is sufficient** — Expand state does not need to persist across sessions. New conversation = fresh state.