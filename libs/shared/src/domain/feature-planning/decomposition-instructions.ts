// A worked `feature-decompose` result (ADR-029), the fixture parseDecomposition is held to; the prompt itself ships as libs/shared/src/agent-defaults/feature-decompose.md.

export const DECOMPOSITION_EXAMPLE = JSON.stringify({
  stories: [
    {
      title: "Favorite a repo from the repo page",
      summary:
        "A developer can star a repo and revisit it from a Favorites list.",
      acceptance_criteria: [
        "Clicking the star toggles the repo's favorite state and persists it",
        "The Favorites list shows exactly the repos the developer starred",
      ],
      tasks: [
        {
          id: "T001",
          description: "Add a favorites join table (user_id, repo, created_at)",
          depends_on: [],
          parallelizable: false,
          phase: 1,
          file_path: "migrations/00NN_favorites.sql",
          title: "Store which repos each developer starred",
          context:
            "Favorites need a durable record before any endpoint or view can read one; every other task in this story builds on this table.",
          changes:
            "New migration `migrations/00NN_favorites.sql` (next free number): table `favorites (user_id text, repo text, created_at timestamptz default now())`, primary key `(user_id, repo)`.",
          acceptance_criteria: [
            "The migration applies on an empty database and re-runs as a no-op",
            "Starring the same repo twice keeps one row",
          ],
          test_plan:
            "Apply the migration locally; insert the same (user, repo) twice and see one row.",
          references: ["specs/favorites/plan.md#data-model"],
          plan_quotes: [
            "A favorite is one row per developer and repo; starring twice changes nothing.",
          ],
        },
        {
          id: "T002",
          description: "Add a toggle-favorite API endpoint",
          depends_on: ["T001"],
          parallelizable: true,
          phase: 2,
          title: "Toggle a favorite over the API",
          context:
            "The star button and the list both go through this endpoint; it is the only writer of the favorites table.",
          changes:
            "`POST /api/repos/:owner/:repo/favorite` flips the caller's row and answers `{ favorite: boolean }`; route + test beside the existing repo routes.",
          acceptance_criteria: [
            "A first call answers favorite true, a second answers false",
            "An unauthenticated call answers 401",
          ],
          test_plan: "Route test calling it twice for one user and repo.",
          references: ["specs/favorites/spec.md#FR-001"],
          plan_quotes: [
            "The star is a toggle: one endpoint flips it and answers the new state.",
          ],
        },
        {
          id: "T003",
          description: "Star button on the repo page wired to the endpoint",
          depends_on: ["T002"],
          parallelizable: true,
          phase: 2,
          file_path: "web-ui/StarButton.tsx",
          title: "Star button on the repo page",
          context:
            "How a developer marks a favorite; the first user-visible piece of the story.",
          changes:
            "New `web-ui/StarButton.tsx` beside the repo page header: filled when favorite, calls the toggle endpoint and shows the answered state.",
          acceptance_criteria: [
            "The button reflects the stored state on load",
            "Clicking it flips the state without a reload",
          ],
          test_plan: "Component test with the endpoint stubbed both ways.",
          references: ["specs/favorites/spec.md#user-story-1"],
          plan_quotes: [
            "The star sits beside the repo page header, where the repo's name is.",
          ],
        },
        {
          id: "T004",
          description: "Favorites list view and nav entry",
          depends_on: ["T002"],
          parallelizable: true,
          phase: 3,
          title: "Favorites list in the navigation",
          context: "Where a developer finds the repos they starred again.",
          changes:
            "A Favorites page listing the caller's starred repos, newest first, and a nav entry to it.",
          acceptance_criteria: [
            "The list shows exactly the starred repos",
            "An empty list says so rather than showing nothing",
          ],
          test_plan: "Page test with zero and two favorites.",
          references: ["specs/favorites/spec.md#user-story-2"],
          plan_quotes: [
            "Favorites gets its own entry in the navigation, newest first.",
          ],
        },
      ],
    },
  ],
});
