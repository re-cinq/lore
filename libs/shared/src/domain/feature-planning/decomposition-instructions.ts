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
        },
        {
          id: "T002",
          description: "Add a toggle-favorite API endpoint",
          depends_on: ["T001"],
          parallelizable: true,
          phase: 2,
        },
        {
          id: "T003",
          description: "Star button on the repo page wired to the endpoint",
          depends_on: ["T002"],
          parallelizable: true,
          phase: 2,
          file_path: "web-ui/StarButton.tsx",
        },
        {
          id: "T004",
          description: "Favorites list view and nav entry",
          depends_on: ["T002"],
          parallelizable: true,
          phase: 3,
        },
      ],
    },
  ],
});
