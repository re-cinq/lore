class RefusalCounter {
  private readonly counts = new Map<string, number>();

  bump(repo: string, prNumber: number): number {
    const key = `${repo}#${prNumber}`;
    const count = (this.counts.get(key) ?? 0) + 1;

    this.counts.set(key, count);

    return count;
  }

  reset(repo: string, prNumber: number): void {
    this.counts.delete(`${repo}#${prNumber}`);
  }
}

/** Base class providing the in-memory unclassified-refusal counter that both the memory and pg adapters share. */
export abstract class PrBlockedReasonsBase {
  private readonly refusalCounter = new RefusalCounter();

  async bumpUnclassifiedRefusal(
    repo: string,
    prNumber: number,
  ): Promise<number> {
    return this.refusalCounter.bump(repo, prNumber);
  }

  async resetUnclassifiedRefusals(
    repo: string,
    prNumber: number,
  ): Promise<void> {
    this.refusalCounter.reset(repo, prNumber);
  }
}
