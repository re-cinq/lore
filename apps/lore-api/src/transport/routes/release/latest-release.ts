// GET the latest public release: the sidebar compares it with the running version and only tells people. It always reads github.com, never GITHUB_HOST, because a GitHub Enterprise install still wants the public releases.
import type { Lifecycle, ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { updateAvailable } from "@re-cinq/lore-shared/release/update-available.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";

const CACHE_MS = 60 * 60 * 1000;

const LatestReleaseQuerySchema = z.object({ running: z.string().optional() });

const LatestReleaseSchema = z.object({
  latest: z.string().nullable(),
  url: z.string().nullable(),
  releasesUrl: z.string(),
  updateAvailable: z.boolean(),
});

const ROUTE_AUTH = {
  ...bearerScope("read"),
  validate: { query: zodValidate(LatestReleaseQuerySchema) },
};

const GithubReleaseSchema = z.object({
  tag_name: z.string(),
  html_url: z.string(),
});

interface PublishedRelease {
  latest: string | null;
  url: string | null;
}

export interface LatestReleaseSeams {
  publicRepo: string;
  fetch: (url: string) => Promise<Response>;
  now: () => number;
}

export function latestReleaseSeams(): LatestReleaseSeams {
  return {
    publicRepo: process.env.LORE_PUBLIC_REPO || "re-cinq/lore",
    fetch: (url) =>
      fetch(url, {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(5000),
      }),
    now: Date.now,
  };
}

export function latestReleaseRoute(
  seams: LatestReleaseSeams = latestReleaseSeams(),
): ServerRoute {
  return {
    method: "GET",
    path: "/api/release",
    options: zodResponse(ROUTE_AUTH, LatestReleaseSchema, {
      name: "LatestRelease",
      description:
        "The latest GitHub release of the public repository, and whether it is newer than the running version given as `running`",
    }),
    handler: serveLatestRelease(seams),
  };
}

function serveLatestRelease(seams: LatestReleaseSeams): Lifecycle.Method {
  const latestRelease = cachedForAnHour(seams);
  const releasesUrl = `https://github.com/${seams.publicRepo}/releases`;

  return async (request) => {
    const { running } = request.query as z.infer<
      typeof LatestReleaseQuerySchema
    >;
    const { latest, url } = await latestRelease();

    return {
      latest,
      url,
      releasesUrl,
      updateAvailable:
        running !== undefined && updateAvailable(running, latest),
    };
  };
}

/** A failed read is kept for the hour too, so an unreachable GitHub is not asked again before the unauthenticated rate limit could matter. */
function cachedForAnHour(seams: LatestReleaseSeams) {
  let cached: { at: number; release: PublishedRelease } | null = null;

  return async (): Promise<PublishedRelease> => {
    if (cached && seams.now() - cached.at < CACHE_MS) {
      return cached.release;
    }
    const at = seams.now();
    const release = await readLatestRelease(seams);

    cached = { at, release };

    return release;
  };
}

async function readLatestRelease(
  seams: LatestReleaseSeams,
): Promise<PublishedRelease> {
  const none = { latest: null, url: null };

  try {
    const response = await seams.fetch(
      `https://api.github.com/repos/${seams.publicRepo}/releases/latest`,
    );
    const body = GithubReleaseSchema.safeParse(
      response.ok ? await response.json() : null,
    );

    return body.success
      ? { latest: body.data.tag_name, url: body.data.html_url }
      : none;
  } catch {
    return none;
  }
}
