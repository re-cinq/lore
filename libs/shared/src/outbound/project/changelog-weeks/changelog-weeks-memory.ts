import type { ChangelogWeek } from "../../../domain/models/changelog-week.js";
import type {
  ChangelogWeeksPort,
  ChangelogWeekWrite,
} from "./changelog-weeks-port.js";

/** In-memory ChangelogWeeksPort, the behavioral spec of the pg adapter. */
export class InMemoryChangelogWeeks implements ChangelogWeeksPort {
  readonly rows: ChangelogWeek[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  async upsert(week: ChangelogWeekWrite): Promise<void> {
    const at = this.rows.findIndex(
      (row) => row.repo === week.repo && row.weekKey === week.weekKey,
    );
    const row = { ...week, writtenAt: this.now() };

    if (at >= 0) {
      this.rows.splice(at, 1, row);

      return;
    }
    this.rows.push(row);
  }

  async writtenWeeks(repo: string, weekKeys: string[]): Promise<string[]> {
    return this.rows
      .filter((row) => row.repo === repo && weekKeys.includes(row.weekKey))
      .map((row) => row.weekKey);
  }

  async page(
    repo: string,
    { before, limit }: { before?: string; limit: number },
  ): Promise<ChangelogWeek[]> {
    return this.rows
      .filter((row) => row.repo === repo)
      .filter((row) => before === undefined || row.weekKey < before)
      .sort((a, b) => b.weekKey.localeCompare(a.weekKey))
      .slice(0, limit);
  }
}
