import { z } from "zod";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { bearerScope } from "../../http/bearer-scope.js";
import { OkSchema } from "../../http/ok-schema.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { withPool } from "../with-pool.js";

const IsoDatetime = z.string().datetime({ offset: true });

export const InboxItemStateBody = z.object({
  person: z.string().min(1),
  handled: z.boolean().optional(),
  snoozed_until: IsoDatetime.nullable().optional(),
});

type InboxItemStateBody = z.infer<typeof InboxItemStateBody>;

export function inboxItemStatePutRoute(
  getPool: () => Pool | null,
): ServerRoute {
  return {
    method: "PUT",
    path: "/api/inbox/items/{item_id}/state",
    options: zodResponse(
      {
        ...bearerScope("write"),
        validate: { payload: zodValidate(InboxItemStateBody) },
      },
      OkSchema,
      {
        name: "InboxItemStateSaved",
        description: "The per-person inbox item state was saved",
      },
    ),
    handler: withPool(getPool, serveInboxItemStatePut),
  };
}

const UPSERT_STATE_SQL = `INSERT INTO lore.inbox_item_state (person, item_id, handled_at, snoozed_until, updated_at)
  VALUES ($1, $2, $3, $4, now())
  ON CONFLICT (person, item_id) DO UPDATE SET
    handled_at = CASE WHEN $5 THEN EXCLUDED.handled_at ELSE lore.inbox_item_state.handled_at END,
    snoozed_until = CASE WHEN $6 THEN EXCLUDED.snoozed_until ELSE lore.inbox_item_state.snoozed_until END,
    updated_at = now()`;

async function serveInboxItemStatePut(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { item_id: itemId } = request.params as { item_id: string };
  const { person, handled, snoozed_until } =
    request.payload as InboxItemStateBody;

  await pool.query(UPSERT_STATE_SQL, [
    person,
    itemId,
    handled ? new Date() : null,
    snoozed_until ?? null,
    handled !== undefined,
    snoozed_until !== undefined,
  ]);

  return h.response({ ok: true }).code(200);
}
