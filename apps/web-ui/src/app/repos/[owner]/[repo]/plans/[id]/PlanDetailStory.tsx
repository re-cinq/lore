"use client";

import { useState, type ComponentProps } from "react";
import type { RefineAsk } from "@/lib/api/plans";
import PlanDetailView from "./PlanDetailView";

type Outcome = Promise<{ error?: string }>;

/** The actions that start a run, each told the user story typed on the page. */
interface StoryActions {
  draftAgain: (story: string) => Outcome;
  refine: (request: RefineAsk, story: string) => Outcome;
  retrySpecWork: (story: string) => Outcome;
}

type PlanDetailStoryProps = Omit<
  ComponentProps<typeof PlanDetailView>,
  "story" | keyof StoryActions
> &
  StoryActions;

/** The plan page holding the user story typed for a run that carries none, until an action starts the next run with it. */
export default function PlanDetailStory({
  draftAgain,
  refine,
  retrySpecWork,
  ...props
}: PlanDetailStoryProps) {
  const [story, setStory] = useState("");

  return (
    <PlanDetailView
      {...props}
      story={{ value: story, onChange: setStory }}
      draftAgain={() => draftAgain(story)}
      refine={(request) => refine(request, story)}
      retrySpecWork={() => retrySpecWork(story)}
    />
  );
}
