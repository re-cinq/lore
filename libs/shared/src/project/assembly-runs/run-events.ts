// The wire names of the run lifecycle events, single-sourced.
//
// Both constants carry the LEGACY spelling on purpose: a Floor that predates the
// AssemblyRun rename dead-letters an event name it does not know (the loop marks
// unknown names dead, no retry), so the writers must keep emitting the spelling
// every deployed Floor answers to. The new registry already handles both.
//
// FLIP these to `assembly_run.start` / `assembly_run.resume` only when every
// Floor is at or past the release that registered the new spellings — the
// writer-flip follow-up, alongside the CR label and telemetry column renames.

export const RUN_START_EVENT = "assembly_line.start";

export const RUN_RESUME_EVENT = "assembly_line.resume";
