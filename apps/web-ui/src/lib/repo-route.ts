import { serverError } from "@/lib/api-error";

/** A per-repo browser endpoint: the `[owner]/[repo]` segments joined, the query string every one of them reads, and the context-tagged 500 they all answer an unexpected throw with. */
export function repoRoute(
  errorContext: string,
  handler: (
    fullName: string,
    searchParams: URLSearchParams,
  ) => Promise<Response>,
) {
  return async function GET(
    req: Request,
    { params }: { params: Promise<{ owner: string; repo: string }> },
  ) {
    const { owner, repo } = await params;

    try {
      return await handler(`${owner}/${repo}`, new URL(req.url).searchParams);
    } catch (err) {
      return serverError(errorContext, err);
    }
  };
}
