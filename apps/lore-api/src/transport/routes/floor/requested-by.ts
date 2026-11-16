import type { Request } from "@hapi/hapi";
import { principalOf } from "../../http/bearer-scope.js";

/** A person's session names the person; only a service token, which has none, may say who it acts for. */
export function requestedByOf(
  request: Request,
  claimed: string | undefined,
): string | undefined {
  return principalOf(request).user?.login ?? claimed;
}
