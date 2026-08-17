// The wire names of the run lifecycle events, single-sourced.
//
// These carried the LEGACY spelling until every deployed Floor could answer to the
// new one: the loop marks an unknown event name dead with no retry, so a writer
// that ran ahead of its readers would lose a run — or a person's plan-accept,
// behind a 202.
//
// Flipped 2026-08-17: every deployed Floor is at or past the readers-first release (8cc5609c, deployed from e499668e with deploy+smoke green), so all readers accept both spellings. The legacy READERS stay one more release — events queued and CRs created before this flip still carry the old name.
//
// The registry's `assembly_line.*` entries are what makes this safe in the other
// direction too, and they are the next thing to remove — not now.

export const RUN_START_EVENT = "assembly_run.start";

export const RUN_RESUME_EVENT = "assembly_run.resume";
