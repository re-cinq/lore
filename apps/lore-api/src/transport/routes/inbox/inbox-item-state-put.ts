import { z } from "zod";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import { withPool } from "../with-pool.js";

export const InboxItemStateBody = z.object({
  person: z.string(),
  handled: z.boolean().optional(),
  snoozed_until: z.string().nullable().optional(),
});

type InboxItemStateBody = z.infer<typeof InboxItemStateBody>;

export function inboxItemStatePutRoute(
  getPool: () => Pool | null,
): ServerRoute {
  return {
    method: "PUT",
    path: "/api/inbox/items/{item_id}/state",
    options: {
      ...bearerScope("write"),
      validate: {
        payload: zodValidate(InboxItemStateBody),
      },
    },
    handler: withPool(getPool, serveInboxItemStatePut),
  };
}

async function serveInboxItemStatePut(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { item_id: itemId } = request.params as { item_id: string };
  const { person, handled, snoozed_until } =
    request.payload as InboxItemStateBody;

  await pool.query(
    `INSERT INTO lore.inbox_item_state (person, item_id, handled_at, snoozed_until, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (person, item_id) DO UPDATE SET
       handled_at = EXCLUDED.handled_at,
       snoozed_until = EXCLUDED.snoozed_until,
       updated_at = now()`,
    [person, itemId, handled ? new Date() : null, snoozed_until ?? null],
  );

  return h.response({ ok: true }).code(200);
}
