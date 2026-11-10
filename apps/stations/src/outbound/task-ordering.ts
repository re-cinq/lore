// Shared dependency-ordering check for blocked-reason and approve-merge (specs/protected-branch-merge).

export interface DependencyPort {
  getTaskDependsOn(taskId: string): Promise<string[]>;
  getTaskPr(taskId: string): Promise<number | null>;
}

export interface PullReader {
  get(prNumber: number): Promise<{ state: string } | null>;
}

export function blockingDependencyPrOpt(
  port: Partial<DependencyPort>,
  pulls: PullReader,
  prNumber: number,
  body: string | null | undefined,
): Promise<number | null> {
  const { getTaskDependsOn, getTaskPr } = port;

  if (!getTaskDependsOn || !getTaskPr) {
    return Promise.resolve(null);
  }

  return blockingDependencyPr(
    { getTaskDependsOn, getTaskPr },
    pulls,
    prNumber,
    body,
  );
}

export async function blockingDependencyPr(
  deps: DependencyPort,
  pulls: PullReader,
  prNumber: number,
  body: string | null | undefined,
): Promise<number | null> {
  const taskId = taskIdOfBody(body);

  if (!taskId) {
    return null;
  }

  const dependsOn = await deps.getTaskDependsOn(taskId);

  return findFirstBlocker(pulls, prNumber, dependsOn, deps.getTaskPr);
}

async function findFirstBlocker(
  pulls: PullReader,
  prNumber: number,
  depTaskIds: string[],
  getTaskPr: (id: string) => Promise<number | null>,
): Promise<number | null> {
  for (const depTaskId of depTaskIds) {
    const depPrNumber = await getTaskPr(depTaskId);

    if (await isOpenDep(pulls, prNumber, depPrNumber)) {
      return depPrNumber;
    }
  }

  return null;
}

async function isOpenDep(
  pulls: PullReader,
  prNumber: number,
  depPrNumber: number | null,
): Promise<boolean> {
  if (depPrNumber == null || depPrNumber === prNumber) {
    return false;
  }

  const depPr = await pulls.get(depPrNumber);

  return depPr?.state === "open";
}

const TASK_TRAILER = /^Lore-Task:\s*(\S+)\s*$/im;

export function taskIdOfBody(body: string | null | undefined): string | null {
  return TASK_TRAILER.exec(body ?? "")?.[1] ?? null;
}
