import type { RouteOptions, ServerRoute } from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import { routeList } from "../route-list.js";
import { repoDeclarationOf } from "./repo-guard.js";

const FACTORY_ROUTES = [
  "POST /api/repos/{owner}/{repo}/utopia/commits",
  "POST /api/repos/{owner}/{repo}/utopia/memory",
  "POST /api/repos/{owner}/{repo}/utopia/releases",
  "POST /api/repos/{owner}/{repo}/utopia/tracker",
  "PUT /api/repos/{owner}/{repo}/loops/{key}",
  "DELETE /api/repos/{owner}/{repo}/loops/{key}/pause",
];

function declaredLevels() {
  return Object.fromEntries(
    routeList(() => null).map((route) => [
      `${route.method} ${route.path}`,
      repoDeclarationOf({ route: { settings: optionsOf(route) } })?.level,
    ]),
  );
}

function optionsOf(route: ServerRoute): RouteOptions {
  return typeof route.options === "object" ? route.options : {};
}

describe("the routes lore-api registers", () => {
  it("lists routes made by a factory under their own path with the admin level they declare", () => {
    const levels = declaredLevels();

    expect(
      Object.fromEntries(FACTORY_ROUTES.map((key) => [key, levels[key]])),
    ).toEqual(Object.fromEntries(FACTORY_ROUTES.map((key) => [key, "admin"])));
  });
});
