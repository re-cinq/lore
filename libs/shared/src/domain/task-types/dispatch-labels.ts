/** The `lore:*` label an onboarded repository is seeded with. It no longer names a task type: labelling an Issue for Lore puts it in the implementation loop's backlog (`libs/shared/src/work/backlog/label-dispatch.ts`), and the `lore:review` and `lore:runbook` labels went with the tasks they created. */
export interface DispatchLabel {
  /** The label as it appears on the Issue. */
  name: string;
  /** Hex colour, for the seeding call. */
  color: string;
  description: string;
}

export const DISPATCH_LABELS: readonly DispatchLabel[] = [
  {
    name: "lore:implementation",
    color: "0E8A16",
    description: "Lore: implement this ticket (joins the backlog loop)",
  },
];
