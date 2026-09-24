import type { RefineAsk } from "@/lib/api/plans";

/** The plan's document on the tab's live socket, and the token that opens it. */
export interface PlanSocket {
  documentName: string;
  token: string;
}

type Outcome = Promise<{ error?: string }>;

/** The server actions a plan page hands its editor, bound to one plan of one repo. */
export interface PlanActions {
  openSocket: () => Promise<PlanSocket | { error: string }>;
  approve: () => Outcome;
  /** One section back to the planning agent; an error withdraws the ask in the editor. */
  refine: (request: RefineAsk) => Outcome;
  /** An approved plan back to writing; an open spec PR goes back to the author with it. */
  reopen: () => Outcome;
  /** A fresh spec pass for an approved plan whose spec work failed or whose specs merged. */
  retrySpecWork: () => Outcome;
  /** The spec writer again, in the same line, with the spec PR's unresolved review: the specs are amended on the PR's branch and whatever contradicts the plan comes back to it as questions. */
  reworkSpecs: () => Outcome;
}
