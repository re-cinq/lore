# Five-pass prompt diagnostic, 2026-11-19

This diagnostic reruns five selected stages from the frozen replay with revised hosted prompts. The selected inputs exposed failed completion markers or unsupported blocking findings in the original run. The inputs are already known, so this diagnostic does not qualify either configuration for promotion. [Frozen replay](five-pass-pilot-2026-11-19.md)

Three intent reruns use the exact saved code and test readings, discussion, and verification packet. Two product reruns also use the original intent and challenge readings, including erroneous claims from those stages. Each rerun uses a fresh restricted Claude Code process running Sonnet 4.6 at medium effort, with an empty working directory and the corresponding virtual files supplied over stdin.

The revised prompts make the final marker depend on completion status. They ask reviewers to establish a supported workflow, verify the observed result, and identify the required outcome before raising a blocker. The product prompt also asks reviewers to check a prior stage's runtime claims independently. Intent prompt (deleted with the five passes on 2026-11-20) · Product prompt (deleted with the five passes on 2026-11-20)

## Results

| Stage and saved trial | Frozen result | Revised result |
| --- | --- | --- |
| Intent, delegated captions, full 1 | Complete payload with failure marker | Complete with success marker. Retained “Venue check removed contrary to agreed requirement”. |
| Intent, Monday reservation, full 2 | Complete payload with failure marker | Complete with success marker. Retained the missing refusal and unchanged-ledger assertion as a blocker. |
| Intent, Monday reservation, light 3 | Complete payload with failure marker | Complete with success marker. Retained “Required Monday test is absent”. |
| Product, deferred calendar colours, full 1 | Requested changes based on absent-room behavior | Approved with success marker. Moved absent-room behavior to a question and acknowledged the deferral. |
| Product, crate sizing, full 2 | Requested changes based on a claimed failing test | Approved with success marker. Carried the claimed failure as an observation. |

The revised product prompt lowered the severity of the signed-zero claim, but the model still said “One pre-existing test failure exists for the `-1 → -0` case”. Node returned true for `Object.is(Math.ceil(-1 / 6), -0)`, confirming that the assertion passes. The diagnostic therefore demonstrates better verdict handling with a remaining factual error.
