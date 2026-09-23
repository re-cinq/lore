/** Records a failed start of a run. Only a FAILURE settles here: success navigates away, so clearing `pending` on that path would flash the idle label over a page that is already leaving. */
export function settleStart(
  failure: string | null,
  setError: (error: string | null) => void,
  setPending: (pending: boolean) => void,
): void {
  if (failure !== null) {
    setError(failure);
    setPending(false);
  }
}
