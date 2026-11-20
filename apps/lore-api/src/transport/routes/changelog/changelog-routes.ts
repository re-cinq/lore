import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { releaseNowRoute } from "../release/release-now.js";
import { changelogIntroRoute } from "./changelog-intro.js";
import { changelogRoute } from "./changelog.js";

/** What the Changelog tab reads and starts: its weeks, a week's introduction again, and a release now. */
export function changelogRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [
    changelogRoute(getPool),
    changelogIntroRoute(),
    releaseNowRoute(getPool),
  ];
}
