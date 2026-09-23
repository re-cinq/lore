// The shape of one declared artifact on the agent sink, shared by the sink parser and the handlers that deliver it.

/** A file declared under `output.watch`, raised by the subsystem on agent exit (`{"kind":"file"}`); `content`/`reason` are mutually exclusive — an undelivered declared artifact still reports, carrying why. */
export interface AgentFileEvent {
  taskId: string;
  agentCrName: string | null;
  /** The recipe-declared event name, so one run can raise several artifacts. */
  event: string;
  path: string;
  content: string | null;
  reason: string | null;
  /** The supervisor sent the file's bytes to the Floor's agent-files endpoint instead of inlining them; the event is then only the notice. */
  uploaded: boolean;
}
