/** Who a person is inside a plan: a stable id for presence and approval, the name others see, and the colour of their cursor. */
export interface PlanUser {
  id: string;
  name: string;
  color: string;
}

export interface PlanSession {
  login?: string;
  user?: { name?: string | null } | null;
}

// The GitHub login is the id and the display name is what others see; a session signed in before the login was carried uses its display name for both until its next sign-in.
export function planUserOf(session: PlanSession | null): PlanUser | null {
  const names = [session?.login, session?.user?.name].filter(
    (name): name is string => Boolean(name),
  );
  const id = names.at(0);

  return id ? { id, name: names.at(-1) ?? id, color: colorFor(id) } : null;
}

/** A colour derived from the id, so a person keeps theirs between visits. */
export function colorFor(id: string): string {
  const hue = [...id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 7);

  return `hsl(${hue} 65% 45%)`;
}
