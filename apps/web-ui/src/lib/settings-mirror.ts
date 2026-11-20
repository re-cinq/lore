/** The Public mirror field as the patch to send: the new name, null to clear, undefined when it is absent or unchanged. */
export function parsePublicMirror(
  formData: FormData,
  stored: string | null | undefined,
): string | null | undefined {
  if (!formData.has("public_mirror")) {
    return undefined;
  }
  const typed = String(formData.get("public_mirror")).trim() || null;

  return typed === (stored ?? null) ? undefined : typed;
}
