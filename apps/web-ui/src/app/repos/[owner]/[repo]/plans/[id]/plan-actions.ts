import type { RefineAsk } from "@/lib/api/plans";

/** Where the browser opens this plan's socket, and the token it opens it with. */
export interface PlanSocket {
  wsUrl: string;
  documentName: string;
  token: string;
}

/** The server actions a plan page hands its editor, bound to one plan of one repo. */
export interface PlanActions {
  openSocket: () => Promise<PlanSocket | { error: string }>;
  approve: () => Promise<{ error?: string }>;
  /** One section back to the planning agent; an error withdraws the ask in the editor. */
  refine: (request: RefineAsk) => Promise<{ error?: string }>;
}
