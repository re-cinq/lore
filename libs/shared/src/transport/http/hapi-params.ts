// hapi 21.4.10 widened request.params/headers to unknown; these are their real shapes, restored program-wide.

import type {} from "@hapi/hapi";

declare module "@hapi/hapi" {
  interface ReqRefDefaults {
    Params: Record<string, string>;
    Headers: Record<string, string | string[] | undefined>;
  }
}

export {};
