// POST /api/floor-runs/stream-token — the token a browser opens the external floor's run list of the live socket with (ADR-048). The web tier has already checked the person's session; lore-api binds the token to the list.

import type { ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import type { z } from "zod";
import { LIVE_RUNS_SUBJECT } from "@re-cinq/lore-shared/models/live-token.js";
import { mintLiveToken } from "../../../work/assembly-line-station/live-tokens.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import {
  RunStreamTokenSchema,
  StreamTokenBody,
} from "../assembly-lines/run-stream-token.js";
import { withPool } from "../with-pool.js";

type LiveUser = { id: string; name: string };

const OPTIONS = zodResponse(
  {
    ...bearerScope("write"),
    validate: { payload: zodValidate(StreamTokenBody) },
  },
  RunStreamTokenSchema,
  {
    name: "FloorRunsStreamToken",
    description:
      "A short-lived token that opens the floor run list's channel of the live socket (/api/ws) as one person",
  },
);

export function floorRunsStreamTokenRoute(
  getPool: () => Pool | null,
  injected?: {
    mint: (user: LiveUser) => Promise<{ token: string; expiresAt: Date }>;
  },
): ServerRoute {
  return {
    method: "POST",
    path: "/api/floor-runs/stream-token",
    options: OPTIONS,
    handler: withPool(getPool, async (pool, request, h) => {
      const { user } = request.payload as z.infer<typeof StreamTokenBody>;
      const mint = injected?.mint ?? mintRunsToken(pool);
      const minted = await mint(user);

      return h.response({ token: minted.token, expires_at: minted.expiresAt });
    }),
  };
}

function mintRunsToken(pool: Pool) {
  return (user: LiveUser) =>
    mintLiveToken(() => pool, {
      kind: "runs",
      subject: LIVE_RUNS_SUBJECT,
      user,
    });
}
