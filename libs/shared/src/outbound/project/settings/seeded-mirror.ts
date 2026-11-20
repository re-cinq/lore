interface SeededRepo {
  full_name: string;
  settings?: Record<string, unknown> | null;
}

export function mirrorNameOf(
  settings: Record<string, unknown> | null | undefined,
): string | undefined {
  const mirror = settings?.public_mirror;

  return typeof mirror === "string" ? mirror : undefined;
}

export function isMirror(repos: SeededRepo[], repo: SeededRepo): boolean {
  return repos.some(
    (publisher) =>
      mirrorNameOf(publisher.settings)?.toLowerCase() ===
      repo.full_name.toLowerCase(),
  );
}
