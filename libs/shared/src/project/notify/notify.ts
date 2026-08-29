import type {
  NotifyPort,
  NotifyLevel,
  NotifyResult,
  NotifyOptions,
} from "./notify-port.js";

/**
 * project.notify — repo-bound notification dispatch. Channel filtering and the
 * Slack send live behind the port (the adapter reuses decideNotify).
 */
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
