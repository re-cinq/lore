# Feature Specification: Collaborative Feature Planning

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | Collaborative Feature Planning              |
| Branch         | feat/collaborative-feature-planning         |
| Status         | Draft                                       |
| Created        | 2026-09-16                                  |
| Owner          | Platform Engineering                        |

Collaborative Feature Planning lets several signed-in people shape the same feature draft at the same time — seeing who is on the page, typing into the same round feedback with live cursors, and merging their edits without conflicts — so a planning round carries the whole team's input instead of one author's.

## Problem Statement

Smart Feature Planning (`specs/7-feature-planning`) made spec authoring
interactive, but only for one person. Everything about it assumes a single
author:

- **Nobody is identified.** A feature's `created_by` is the literal `"ui"`
  (`features-memory.ts`), even though every web-ui visitor is signed in with
  GitHub through next-auth. The system cannot say who started a draft or who
  wrote a comment.
- **Feedback is one private form.** A round's per-section comments, directions,
  question answers and free-form input live in local React state until one
  browser posts them as `user_answers`. Two people on the same page each fill in
  their own copy; whoever presses **Refine again** first wins, and the other
  person's input is silently lost (the second press is refused with 409, FR-4.5).
- **Nothing is live.** The wizard polls every four seconds for round status;
  there is no way to see that a colleague is on the page, let alone what they are
  typing.

In practice a PM, a tech lead and a designer who want to plan together sit on a
call while one of them drives. The step that should be the most collaborative in
the pipeline still funnels through a single keyboard.

## Vision

A PM opens a draft feature and shares the link. Teammates who open it appear as
avatars at the top of the page, and each gap section shows who is currently in
it. When anyone types into a section comment, a question answer, or the
free-form box, everyone sees the text appear with that person's coloured cursor
and name. Picking a direction (keep / refine / redirect) updates for everyone at
once. If two people type in the same field, both edits land — nothing is
overwritten.

Every contribution is attributed. When someone presses **Refine again**, the
round is sealed with a snapshot of the shared feedback, everyone on the page sees
who started it, the inputs lock for the duration of the round, and the planning
agent receives the feedback *with authorship*, so it can notice when the tech
lead and the PM disagree about a section. When the round lands, a fresh shared
feedback space opens for the next round.

Closing the laptop mid-sentence loses nothing: edits made while disconnected
merge when the connection returns.

## Integration & Relationships

- **Smart Feature Planning (`specs/7-feature-planning`, ADR-027/029).** This
  feature changes *how round feedback is authored*, not what a round is. The
  `user_answers` contract (FR-4.1/4.2), the `feature_review` human station and its
  accept / refine / abandon outcomes (FR-4.7), the single-round-in-flight rule
  (FR-4.5) and the single-finalize rule (FR-12.11) all stand. The planning line
  (`analyze → author → …`) is unchanged; the `author` wait node is simply resumed
  by whichever collaborator acts.
- **Web-UI auth (`apps/web-ui/src/lib/session.ts`, `user-repo-access.ts`).** The
  GitHub session already identifies the viewer, and `userCanAccessRepo` already
  answers "may this person see this repo". Collaboration reuses both; it adds no
  new identity provider or invitation system.
- **SSE run observability (ADR-037).** ADR-037 introduced the stack's only
  streaming transport, one-way, carried by an in-process pub/sub that is sound
  only under a pinned single replica. Live co-editing needs a **bidirectional**
  channel and durable document state, which ADR-037 does not provide. The
  transport, merge algorithm and persistence are decided in a new ADR (see
  Open Decisions) *before* implementation, per the ADR-before-implementation
  practice. The single-replica constraint (`lore-api-helm` `replicaCount: 1`)
  applies to it the same way and must be named, not assumed away.
- **Project facade & ports (ADR-024).** Shared feedback documents and
  contributor attribution are persisted behind the existing `features` port on
  the Project object, alongside iterations.
- **Planning prompt (`scripts/task-types.yaml`, FR-2.3/2.6).** The composed
  timeline gains authorship on each prior comment and answer. The prompt is still
  the yaml template verbatim.

## User Personas

### Feature Author (Product Owner / PM)

Starts the draft, shares the link, and runs the planning session with others.
Wants everyone's input captured in the round without retyping what people said
on a call.

### Collaborator (Tech Lead, Designer, Developer, Stakeholder)

Opens a shared draft to add context the author does not have: technical
constraints, UX concerns, edge cases. Expects to type directly into the
relevant section and to see that their contribution was used.

### Platform Engineer

Operates the real-time service: needs it to fail safe (planning still works
without it), stay within the single-replica deployment, and not leak a repo's
draft to someone without access to that repo.

## User Scenarios & Acceptance Criteria

### Scenario 1: Joining a shared draft and seeing who is there

**Actor:** Collaborator

**Flow:**
1. The author copies the feature page URL and sends it to a teammate.
2. The teammate opens it, signed in with GitHub.
3. Both see each other's avatar and GitHub login in a presence bar, and each gap
   section shows who is currently focused inside it.
4. When the teammate closes the tab, their avatar disappears for the author.

**Acceptance Criteria:**
- A signed-in user with GitHub access to the repo can open a shared draft and
  join its session; a user without access to the repo is refused and receives no
  draft content or presence data.
- The presence bar lists every connected user once, by GitHub login and avatar,
  even when one user has the page open in several tabs.
- Each gap section shows which users are currently focused inside it.
- A user who disconnects is removed from presence within 10 seconds.
- A feature created from the UI records the creator's GitHub login as
  `created_by` instead of `"ui"`.

### Scenario 2: Co-editing round feedback live

**Actor:** Feature Author and Collaborators

**Flow:**
1. Two or more users are on the same draft while it is awaiting input.
2. One types a comment on the *Data model* section; the others see the text
   appear with that user's named, coloured cursor.
3. Another answers a follow-up question and switches the *API* section's
   direction to **redirect**; everyone sees the change immediately.
4. Two users type into the same free-form box at once; both edits are kept.

**Acceptance Criteria:**
- Section comments, question answers and free-form input are shared text fields:
  an edit by one connected user is visible to every other connected user within
  1 second under normal network conditions.
- Concurrent edits to the same text field merge without losing either user's
  characters and converge to the same text for every user.
- A section's direction is a shared value; concurrent changes resolve to a single
  value that every user sees.
- Remote cursors and selections in text fields are rendered with the owning
  user's login and a stable per-user colour.
- The shared feedback persists server-side: reloading the page, or every user
  leaving and returning later, shows the feedback as last edited.

### Scenario 3: Refining together

**Actor:** Any collaborator

**Flow:**
1. A collaborator presses **Refine again**.
2. Every connected user sees "Round N started by @login", and the feedback inputs
   become read-only for everyone.
3. The planning agent receives the round's feedback with each comment and answer
   attributed to its contributors.
4. When the round is ready, every connected user sees the new sections without
   reloading, and a fresh, empty shared feedback space opens for round N+1.

**Acceptance Criteria:**
- Pressing **Refine again** seals the shared feedback exactly as it is at that
  moment and persists it as the round's `user_answers`; edits that arrive after
  the seal are not included and are rejected with a visible notice to their
  author.
- Only one round can start from a given shared feedback state: when two users
  press **Refine again** at the same time, one round starts and the other user is
  shown who started it (FR-4.5 still applies).
- The iteration records the GitHub login of the user who started it.
- Each persisted comment and answer carries the logins of the users who
  contributed text to it, and the refinement prompt renders those logins next to
  the text.
- While a round is running, the feedback inputs are read-only for every user, and
  the page states who started the round.
- A new round's shared feedback starts empty; the previous round's feedback
  remains visible read-only in the iteration history with its attribution.

### Scenario 4: Accepting or abandoning with others present

**Actor:** Any collaborator

**Flow:**
1. A user presses **Create the spec PR** (or abandons the draft) while others are
   connected, possibly mid-typing.
2. The user is warned that other people are currently editing and asked to
   confirm.
3. On confirm, every connected user sees who accepted or abandoned the draft and
   the page moves to the corresponding state for all of them.

**Acceptance Criteria:**
- Accepting or abandoning while at least one *other* user is connected requires a
  confirmation naming those users.
- The outcome and the acting user's login are broadcast to every connected user,
  whose pages leave the editing state without a reload.
- The acting user's login is recorded against the `feature_review` outcome.

### Scenario 5: Losing and regaining the connection

**Actor:** Collaborator

**Flow:**
1. A collaborator's network drops while they keep typing.
2. The page shows that they are offline and that their edits are pending.
3. The connection returns; their pending edits merge with what others typed in
   the meantime.

**Acceptance Criteria:**
- Edits made while disconnected are kept locally and merged into the shared
  feedback on reconnect without overwriting other users' edits.
- If the round was sealed while the user was offline, their pending edits are not
  merged into the sealed round, and the user is told so with their unsent text
  still available to copy.
- A visible connection indicator distinguishes live, reconnecting and offline.

### Scenario 6: Real-time service unavailable

**Actor:** Feature Author

**Flow:**
1. The real-time service is down or unreachable.
2. The author opens a draft.

**Acceptance Criteria:**
- The page states that live collaboration is unavailable and the planning wizard
  still works single-user, exactly as it does today (local form, submit on
  **Refine again**).
- No planning round, acceptance or abandonment depends on the real-time service
  being reachable.

## Functional Requirements

### FR-1: Identity & Access

- FR-1.1: Every collaboration action is attributed to the viewer's GitHub login
  taken from the server-side next-auth session, never from a client-supplied
  value.
- FR-1.2: Joining a feature's session requires GitHub access to the feature's
  repo, checked with the same rule as `userCanAccessRepo`, at connect time and
  again at least every 15 minutes while connected; a user who loses access is
  disconnected.
- FR-1.3: A session is scoped to exactly one feature; no draft content or presence
  from one feature is delivered to a connection for another.
- FR-1.4: Feature creation from the UI passes the creator's login as `createdBy`;
  `created_by` stops defaulting to `"ui"` for UI-created features.

### FR-2: Presence

- FR-2.1: The system tracks, per feature, the set of connected users with their
  login, avatar URL, colour, and currently focused section (if any).
- FR-2.2: Presence is ephemeral: it is never persisted and never sent to the
  planning agent.
- FR-2.3: A user with several connections to the same feature appears once.

### FR-3: Shared Feedback Document

- FR-3.1: Each feature has at most one *open* shared feedback document, bound to
  the iteration it will seed. It holds, per section, a comment (shared text) and a
  direction (shared value), per question an answer (shared text), and one
  free-form shared text.
- FR-3.2: Concurrent edits merge with a conflict-free algorithm that converges to
  identical state on every client regardless of the order updates arrive.
- FR-3.3: The document's state is persisted server-side durably enough that a
  restart of the real-time service loses at most the last 2 seconds of edits.
- FR-3.4: For each text field the document records the set of logins that
  contributed characters to it.
- FR-3.5: Sealing a document converts it to the existing `user_answers` shape
  (`specs/7-feature-planning/data-model.md`) plus an additive `contributors` map,
  so `parseUserAnswers` and every existing consumer keep working unchanged.
- FR-3.6: A sealed document is immutable; updates addressed to it are rejected.

### FR-4: Round Actions

- FR-4.1: **Refine again**, **Create the spec PR** and **Abandon** remain the
  existing API calls; the server, not the client, seals the shared document from
  its own copy when the call is accepted, so a client that has not received the
  latest edits cannot drop them.
- FR-4.2: Seal-and-start is atomic with the existing in-flight guard: at most one
  round starts per open document.
- FR-4.3: The acting login is stored on the iteration (`started_by`) and on the
  `feature_review` outcome.
- FR-4.4: Round start, round ready, round failed, accept and abandon are broadcast
  to connected users of that feature, replacing the 4-second poll for connected
  clients (the poll remains the fallback).

### FR-5: Planning Prompt

- FR-5.1: The refinement round's composed timeline renders the contributor logins
  beside each prior section comment and question answer.
- FR-5.2: A round seeded by a single contributor renders identically to today apart
  from the login, so existing prompt tests keep their meaning.

### FR-6: Resilience & Operations

- FR-6.1: The real-time service runs within the current single-replica deployment
  and documents that constraint and its multi-replica escape hatch, as ADR-037
  does for SSE.
- FR-6.2: Planning works without the real-time service (Scenario 6).
- FR-6.3: Message size and per-connection update rate are bounded so one client
  cannot degrade a session for others; a client exceeding the bound is
  disconnected with a stated reason.
- FR-6.4: Shared feedback documents of features that are deleted are deleted with
  them (cascade).

## Success Criteria

- A planning session with 5 simultaneous collaborators on one draft shows each
  edit to the others within 1 second (p95) on the production deployment.
- Zero lost feedback: in a scripted concurrent-edit test with 5 clients and
  simultaneous **Refine again** presses, every character typed before the seal
  appears in the round's `user_answers`, and exactly one round starts.
- Within 30 days of release, at least 30% of planning rounds on active repos carry
  input from 2 or more contributors.
- Planning round success rate does not drop compared with the 30 days before
  release, including during real-time service outages.

## Out of Scope (v1)

- Hand-editing the generated draft spec markdown (`draft_spec_markdown`) — it
  remains agent-owned.
- Invitations, per-feature roles, or restricting a draft to named people beyond
  repo access.
- Threaded discussion, @mentions, notifications, or email/Slack alerts.
- Collaborative editing of the initial prompt on the **+ Feature** page.
- Live co-editing anywhere outside the feature planning wizard.

## Open Decisions

- **OD-1 (ADR required): transport, merge algorithm and persistence.** Candidates:
  a CRDT library (e.g. Yjs) over a WebSocket endpoint hosted by lore-api, with
  document snapshots and updates in Postgres; versus a managed service. The ADR
  must address the single-replica pin, auth at connect, and the offline merge
  semantics above. Evaluated with `evaluate-existing-solutions` before choosing.
- **OD-2: Who may press Refine / Accept / Abandon.** This spec lets any
  collaborator with repo access do so. If the trust level (`TRUST_LEVELS`) that
  gates who may run planning should also gate these actions per user, that needs
  a product decision.
