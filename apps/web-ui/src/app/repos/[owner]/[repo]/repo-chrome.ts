// Below the repo's base: /plans/<id>, but neither /plans itself nor the new-plan form.
const PLAN_PATH = /^\/plans\/(?!new(?:\/|$))[^/]+/;

/** A single plan's page, not the plans list or the new-plan form. */
export function isPlanPage(pathname: string, base: string): boolean {
  return (
    pathname.startsWith(base) && PLAN_PATH.test(pathname.slice(base.length))
  );
}
