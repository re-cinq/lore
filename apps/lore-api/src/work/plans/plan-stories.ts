// The user story a plan was saved with, held by lore-api rather than by a run's start items, which are fixed once the run starts (specs/7-feature-planning FR-18).

/** What a person saved: an issue number, or null when they removed the link on purpose. */
export interface SavedStory {
  issueNumber: number | null;
}

export interface PlanStories {
  /** Undefined when nobody ever saved a story on the plan. */
  saved(planId: string): Promise<SavedStory | undefined>;
  save(story: {
    planId: string;
    issueNumber: number | null;
    setBy: string;
  }): Promise<void>;
}
