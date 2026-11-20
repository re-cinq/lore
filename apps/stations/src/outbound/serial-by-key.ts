/** Runs the jobs of one key one after another, so two syncs of one repository never share its git cache at once; a failed job does not hold the next. */
export function serialByKey(): <Result>(
  key: string,
  job: () => Promise<Result>,
) => Promise<Result> {
  const tails = new Map<string, Promise<unknown>>();

  return (key, job) => {
    const run = (tails.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(job);

    tails.set(key, run);

    return run;
  };
}
