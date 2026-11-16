import type { ApiResult } from "@/lib/api/result";
import type { components } from "@/lib/api/schema";

type SessionUser = components["schemas"]["AuthMe"];

const UNAUTHORIZED = 401;

interface SessionAnswer {
  status: number;
  body: { signed_in: boolean; expires_at: string | null } | { error: string };
}

/** What the tab is told about its session from lore-api's answer to "who is this": signed in until when, signed out, or, when lore-api could not be asked, nothing either way. */
export function sessionAnswer(me: ApiResult<SessionUser>): SessionAnswer {
  if (me.status === "ok") {
    return {
      status: 200,
      body: { signed_in: true, expires_at: me.data.expires_at },
    };
  }

  return me.status === "unconfigured" || me.code === UNAUTHORIZED
    ? { status: 200, body: { signed_in: false, expires_at: null } }
    : { status: 503, body: { error: me.message } };
}
