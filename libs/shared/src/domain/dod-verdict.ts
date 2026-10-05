/** How a definition-of-done verdict that found the ticket already resolved is written into a visit's failure detail. */
export const DOD_RESOLVED_PREFIX = "already resolved: ";

/** The resolved verdict's reason, read back off a visit's failure detail; null for a blocked verdict or no verdict at all. */
export function dodResolvedReason(
  failureDetail: string | null | undefined,
): string | null {
  return failureDetail?.startsWith(DOD_RESOLVED_PREFIX)
    ? failureDetail.slice(DOD_RESOLVED_PREFIX.length)
    : null;
}
