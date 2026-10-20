interface AuditUrlParams {
  agent?: string | null;
  op?: string | null;
  offset: number;
}

/** The current filters carried into a link, so paging never silently widens the view. */
export function auditUrl({ agent, op, offset }: AuditUrlParams): string {
  const p = new URLSearchParams();

  if (agent) {
    p.set("agent", agent);
  }

  if (op) {
    p.set("op", op);
  }

  if (offset > 0) {
    p.set("offset", String(offset));
  }
  const qs = p.toString();

  return `/audit${qs ? `?${qs}` : ""}`;
}
