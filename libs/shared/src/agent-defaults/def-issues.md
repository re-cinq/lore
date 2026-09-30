---
execution_mode: station
command: [ "lore-station", "issues" ]
# Files one Issue per story and one spec-task per task over the Lore API — no
# clone, no LLM, no repo mutation. The work is bounded by the decomposition it
# was handed, so a few minutes is generous.
timeout_minutes: 10
---
