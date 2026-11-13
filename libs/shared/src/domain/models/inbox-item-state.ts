import { z } from "zod";
import type { ColumnMap } from "../../lib/row.js";

export const INBOX_ITEM_STATE_TABLE = "lore.inbox_item_state";

export const InboxItemStateSchema = z.object({
  person: z.string(),
  item_id: z.string(),
  handled_at: z.date().nullable(),
  snoozed_until: z.date().nullable(),
  updated_at: z.date(),
});

export type InboxItemState = z.infer<typeof InboxItemStateSchema>;

export const INBOX_ITEM_STATE_COLUMNS = {
  person: "person",
  item_id: "item_id",
  handled_at: "handled_at",
  snoozed_until: "snoozed_until",
  updated_at: "updated_at",
} as const satisfies ColumnMap<InboxItemState>;
