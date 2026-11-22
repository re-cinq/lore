import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  Lifecycle,
  Request,
  ResponseToolkit,
  RouteOptions,
  Server,
  ServerRoute,
} from "@hapi/hapi";
import { setAppClientWriteGuard } from "@re-cinq/lore-shared/project/lib/app-client-guard.js";
import { principalOf } from "./bearer-scope.js";

const servingPerson = new AsyncLocalStorage<boolean>();

/** FR-311: while a handler serves a person's session, a GitHub write through the App's client throws instead of acting as the App. */
export function registerPersonAppClientGuard(server: Server): void {
  setAppClientWriteGuard((method) => {
    enforceTrue(
      !servingPerson.getStore(),
      Error,
      `a person's request must not ${method} GitHub through the App's client; act with the person's token (actingEnv)`,
    );
  });
  const route = server.route.bind(server);

  // The handler is wrapped, not an extension: a store entered in a lifecycle extension does not reach the handler's async chain.
  server.route = ((routes: ServerRoute | ServerRoute[]) =>
    route(
      Array.isArray(routes)
        ? routes.map(withPersonContext)
        : withPersonContext(routes),
    )) as Server["route"];
}

function withPersonContext(definition: ServerRoute): ServerRoute {
  const { options } = definition;
  const handler =
    definition.handler ??
    (typeof options === "object" ? options.handler : undefined);

  if (typeof handler !== "function") {
    return definition;
  }
  const wrapped = (request: Request, h: ResponseToolkit) =>
    servingPerson.run(isPerson(request), () =>
      handler.call(undefined, request, h),
    ) as Lifecycle.ReturnValue;

  return definition.handler
    ? { ...definition, handler: wrapped }
    : {
        ...definition,
        options: { ...(options as RouteOptions), handler: wrapped },
      };
}

function isPerson(request: Request): boolean {
  return request.auth.isAuthenticated && principalOf(request).user !== null;
}
