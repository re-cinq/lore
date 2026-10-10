// A human station's page, from the route its station declares (run-viz FR4.1i). The floor stores the template and never fills it: `{args.x}` names a run arg, `{x}` a need of the visit (then a run arg, then the repo). A placeholder nothing fills makes no route at all, never half of one.

export interface RouteScope {
  args: Record<string, unknown>;
  needs: Record<string, string>;
  repo?: string;
}

const PLACEHOLDER =
  /\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)\}/g;

export function resolveRoute(
  template: string,
  scope: RouteScope,
): string | null {
  const names = [...template.matchAll(PLACEHOLDER)].map((match) => match[1]);
  const values = new Map(names.map((name) => [name, valueOf(scope, name)]));

  if ([...values.values()].some((value) => value === null)) {
    return null;
  }

  return template.replace(
    PLACEHOLDER,
    (_match, name: string) => values.get(name) ?? "",
  );
}

function valueOf(scope: RouteScope, name: string): string | null {
  if (name.startsWith("args.")) {
    return scalarOf(scope.args, name.slice("args.".length));
  }

  return (
    scalarOf(scope.needs, name) ??
    scalarOf(scope.args, name) ??
    (name === "repo" ? (scope.repo ?? null) : null)
  );
}

/** Own properties only, as the floor reads a payload: `{constructor}` must not find Object's. */
function scalarOf(
  source: Record<string, unknown>,
  name: string,
): string | null {
  if (!Object.hasOwn(source, name)) {
    return null;
  }
  const value = source[name];

  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;
}
