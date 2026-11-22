import type { WebSocket } from "ws";
import type { SocketPerson } from "./socket-session.js";

/** How long a session check holds before the next frame asks again (FR-280). */
const FRESH_MS = 5 * 60_000;

/** Close code for a socket whose person is no longer a member (FR-283). */
const SESSION_ENDED_CODE = 4401;

/** Close code that tells the client to connect again (FR-285). */
const TRY_AGAIN_CODE = 1013;

/** How long a held frame waits for GitHub's answer before the socket is told to connect again (FR-285). */
const ANSWER_MS = 1_000;

function withinAnswerTime<T>(answer: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const silence = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("no answer")), ANSWER_MS);
  });

  return Promise.race([answer, silence]).finally(() => clearTimeout(timer));
}

/** Holds a socket's frames, in order, while its session is checked again once the last check is older than five minutes. */
export class FreshGate {
  private checkedAt = Date.now();
  private waiting: Promise<void> | null = null;

  constructor(
    private readonly ws: WebSocket,
    private readonly token: string | undefined,
    private readonly person: (token: string) => Promise<SocketPerson | null>,
    private readonly refreshed: (person: SocketPerson) => void = () => {},
  ) {}

  /** Runs `act` at once while the check is fresh; otherwise, in order, after asking again (FR-280). */
  run(act: () => void): void {
    if (!this.due() && !this.waiting) {
      return act();
    }
    const turn = (this.waiting ?? Promise.resolve())
      .then(async () => ((await this.stillValid()) ? act() : undefined))
      .finally(() => {
        if (this.waiting === turn) {
          this.waiting = null;
        }
      });

    this.waiting = turn;
  }

  private due(): boolean {
    return Boolean(this.token) && Date.now() - this.checkedAt >= FRESH_MS;
  }

  /** The session asked again as a request would be: a person no longer a member closes the socket, a GitHub that does not answer closes it so the client connects again (FR-283, FR-285). */
  private async stillValid(): Promise<boolean> {
    if (!this.token || !this.due()) {
      return true;
    }

    try {
      const person = await withinAnswerTime(this.person(this.token));

      if (person) {
        this.checkedAt = Date.now();
        this.refreshed(person);

        return true;
      }
      this.ws.close(SESSION_ENDED_CODE, "session ended");
    } catch {
      this.ws.close(TRY_AGAIN_CODE, "try again");
    }

    return false;
  }
}
