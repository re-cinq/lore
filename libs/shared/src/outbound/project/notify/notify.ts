import type {
  NotifyPort,
  NotifyLevel,
  NotifyResult,
  NotifyOptions,
} from "./notify-port.js";

/** Repo-bound notification dispatch; channel filtering and Slack send live behind the port. */
export class Notify {
  constructor(
    private readonly repo: string,
    private readonly notifier: NotifyPort,
  ) {}

  notify(
    level: NotifyLevel,
    message: string,
    opts?: NotifyOptions,
  ): Promise<NotifyResult> {
    return this.notifier.notify(this.repo, level, message, opts);
  }
}
