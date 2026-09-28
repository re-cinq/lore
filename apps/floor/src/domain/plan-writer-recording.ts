import type {
  FailedRefine,
  PlanAgentEdits,
  PlanFileBody,
  PlanFinding,
  PlanSection,
  PlanWriter,
} from "./plan-writer.js";

/** One write a {@link RecordingPlanWriter} saw, named by the {@link PlanWriter} method that made it. */
export interface PlanWrite {
  method: Exclude<keyof PlanWriter, "markdownOf" | "findingsOf" | "sectionsOf">;
  planId: string;
  body?: unknown;
}

/** The {@link PlanWriter} double: records every write in the order it was made, and reads a plan with no sections and no findings. */
export class RecordingPlanWriter implements PlanWriter {
  readonly writes: PlanWrite[] = [];

  async markdownOf(planId: string): Promise<string> {
    return `# plan ${planId}\n`;
  }

  async findingsOf(): Promise<PlanFinding[]> {
    return [];
  }

  async sectionsOf(): Promise<PlanSection[]> {
    return [];
  }

  async submitFile(planId: string, body: PlanFileBody): Promise<void> {
    this.writes.push({ method: "submitFile", planId, body });
  }

  async failRefine(planId: string, body: FailedRefine): Promise<void> {
    this.writes.push({ method: "failRefine", planId, body });
  }

  async addQuestions(planId: string, body: PlanAgentEdits): Promise<void> {
    this.writes.push({ method: "addQuestions", planId, body });
  }

  async openPresence(
    planId: string,
    body: { name: string; color: string },
  ): Promise<void> {
    this.writes.push({ method: "openPresence", planId, body });
  }

  async closePresence(planId: string): Promise<void> {
    this.writes.push({ method: "closePresence", planId });
  }

  async finishRefine(
    planId: string,
    body: { slot: string; uses: unknown },
  ): Promise<void> {
    this.writes.push({ method: "finishRefine", planId, body });
  }
}
