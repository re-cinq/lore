/** A pack file the sync refused, and why. */
export interface Refusal {
  path: string;
  reason: string;
}

export type Attempt<Made> = { made: Made } | { refusal: Refusal };

/** Runs what builds one pack file's part of the overlay: a file that cannot be built is refused and the others still are. */
export function attempt<Made>(path: string, build: () => Made): Attempt<Made> {
  try {
    return { made: build() };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);

    return { refusal: { path, reason } };
  }
}
