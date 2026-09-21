import { PLAN_KINDS, type PlanKind } from "@re-cinq/planning-document";

/** What the new-plan form asks for: a title, a template, and what the author already knows. */
export interface NewPlanInput {
  title: string;
  type: PlanKind;
  description: string;
}

const isPlanKind = (type: string): type is PlanKind =>
  (PLAN_KINDS as readonly string[]).includes(type);

export function newPlanInput(
  formData: FormData,
): NewPlanInput | { error: string } {
  const title = field(formData, "title");
  const type = field(formData, "type");

  if (!title) {
    return { error: "A plan needs a title." };
  }

  if (!isPlanKind(type)) {
    return { error: `Unknown plan type ${type}.` };
  }

  return { title, type, description: field(formData, "description") };
}

/** The description's paragraphs, as the plan's intent section holds them. */
export function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/** Where the browser opens a plan's socket: the deployment's public address, or next to lore-api when it runs on this machine. */
export function planSocketUrl(
  env: Record<string, string | undefined>,
): string | undefined {
  return (
    env.LORE_PLANS_WS_URL ??
    (env.LORE_API_URL &&
      `${env.LORE_API_URL.replace(/^http/, "ws")}/api/plans/collab`)
  );
}

function field(formData: FormData, key: string): string {
  const raw = formData.get(key);

  return typeof raw === "string" ? raw.trim() : "";
}
