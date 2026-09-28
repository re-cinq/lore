/** Who a person is inside a plan: a stable id for presence and approval, and the name others see. The editor picks their colour. */
export interface PlanUser {
  id: string;
  name: string;
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

  return id ? { id, name: names.at(-1) ?? id } : null;
}
