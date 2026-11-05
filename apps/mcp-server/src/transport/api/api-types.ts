import type { paths } from "./schema.js";

/** A lore-api path that answers GET. */
export type ApiGetPath = {
  [P in keyof paths]: paths[P] extends { get: object } ? P : never;
}[keyof paths];

type GetOperation<P extends ApiGetPath> = paths[P]["get"];

/** The query a GET route validates, as lore-api's OpenAPI document declares it. */
export type ApiQuery<P extends ApiGetPath> =
  GetOperation<P> extends { parameters: { query?: infer Query } }
    ? NonNullable<Query>
    : never;

/** The JSON body a GET route answers 200 with. */
export type ApiAnswer<P extends ApiGetPath> =
  GetOperation<P> extends {
    responses: { 200: { content: { "application/json": infer Body } } };
  }
    ? Body
    : never;

/** `path?query`, the unset fields left out, for a route whose path has no parameters. */
export function apiGetUrl<P extends ApiGetPath>(
  path: P,
  query: ApiQuery<P>,
): string {
  const fields = Object.entries(query as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => [name, String(value)]);

  return fields.length ? `${path}?${new URLSearchParams(fields)}` : path;
}

// The one place a proxied body becomes typed: the shape is lore-api's own, generated from the zod schema it answers with.
export function apiAnswer<P extends ApiGetPath>(
  _path: P,
  body: string,
): ApiAnswer<P> {
  return JSON.parse(body) as ApiAnswer<P>;
}
