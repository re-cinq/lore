// Real agent pod log lines, captured verbatim from a production review node
// (assembly line f202c209, node f202c209-review, 2026-07-17). These are the
// ground truth the parser is written against — do not hand-edit the payloads.

export const LIFECYCLE_STARTED =
  '{"kind":"lifecycle","phase":"agent","status":"started"}';

export const SESSION_INIT =
  '{"type":"system","subtype":"init","cwd":"/","session_id":"ce38714c-16fc-4b0e-9351-3b1b9b86a969","tools":["Task","Bash","CronCreate","CronDelete","CronList","DesignSync","Edit","EnterWorktree","ExitWorktree","Monitor","NotebookEdit","PushNotification","Read","ReportFindings","ScheduleWakeup","SendMessage","Skill","TaskCreate","TaskGet","TaskList","TaskOutput","TaskStop","TaskUpdate","ToolSearch","WebFetch","WebSearch","Workflow","Write"],"mcp_servers":[],"model":"claude-sonnet-4-6","permissionMode":"bypassPermissions","slash_commands":["deep-research","design-sync","dataviz","update-config","verify","debug","code-review","simplify","batch","fewer-permission-prompts","doctor","loop","claude-api","run","run-skill-generator","agents","clear","color","compact","config","context","effort","fast","heapdump","init","mcp","model","__remote-workflow","reload-skills","rename","review","security-review","usage","insights","recap","goal","design","design-consent","design-revoke","team-onboarding"],"apiKeySource":"ANTHROPIC_API_KEY","claude_code_version":"2.1.212","output_style":"default","agents":["claude","Explore","general-purpose","Plan","statusline-setup"],"skills":["deep-research","design-sync","dataviz","update-config","verify","debug","code-review","simplify","batch","fewer-permission-prompts","doctor","loop","claude-api","run","run-skill-generator"],"plugins":[],"capabilities":["interrupt_receipt_v1","msg_lifecycle_v1"],"analytics_disabled":false,"product_feedback_disabled":false,"uuid":"e6d978da-269a-4d96-ad6b-631d1615ec08","memory_paths":{"auto":"/agent/.claude/projects/-/memory/"},"fast_mode_state":"off"}';

export const THINKING_TOKENS_11 =
  '{"type":"system","subtype":"thinking_tokens","estimated_tokens":11,"estimated_tokens_delta":11,"uuid":"b35a648a-ca50-48f0-9b94-57f5dc8e25a2","session_id":"ce38714c-16fc-4b0e-9351-3b1b9b86a969"}';

export const THINKING_TOKENS_21 =
  '{"type":"system","subtype":"thinking_tokens","estimated_tokens":21,"estimated_tokens_delta":10,"uuid":"6d5ab79b-c0ef-429a-9972-a065f72bb328","session_id":"ce38714c-16fc-4b0e-9351-3b1b9b86a969"}';

export const THINKING_TOKENS_444 =
  '{"type":"system","subtype":"thinking_tokens","estimated_tokens":444,"estimated_tokens_delta":55,"uuid":"3e79e11f-c90b-483b-9cbe-53b1b14967f7","session_id":"ce38714c-16fc-4b0e-9351-3b1b9b86a969"}';

export const ASSISTANT_THINKING =
  '{"type":"assistant","message":{"model":"claude-sonnet-4-6","id":"msg_011Cd7LgS7cHZ15UPtj7SZrN","type":"message","role":"assistant","content":[{"type":"thinking","thinking":"Let me review pull request #871 in re-cinq/lore (branch feat/validate-via-station). I\'ll use the review skill to fetch and analyze the PR.","signature":"EvoCCosBCA8YAipAgbvQ1NLNNgQQk659OK+EBEOlbk1TJL/W0z/EjPWw6sC1Pv5BbWRdQu/vEor2lrb0Yi0GVO0MgeU4vn94Sa/eCzIRY2xhdWRlLXNvbm5ldC00LTY4AEIIdGhpbmtpbmdaJGI4NjM3MTRiLTU1NTAtNGQ2MC1iOTMwLTYxYjdjODBmODIzNBIMjd6CmaHWGWSVdrRTGgwR6F6EPu6XK2XIWLYiMMiWSvmrnMJE4D3bGIOU7IoRapPA0/y+DGb2h+nwjdP6PcouUajDBXAANCsZ3dy25CqbAc1595miyAvVtKaOxhSaqAUDS5feSHAnmKxF9HLehsGh9weYUaFe0u43HfhGQmUgNz1qscyzJAIiDlusb7Mch3HDEQBelasMwiLBaEDUvwqmnlPSbNE0f3V0yXszxaCrddWqhjCd2tyV1HvUqHO3VSSmUjj4BUXwvVzyE+5bFeb8wcdC9OulrB4PMOwj//W6ptfQQ2xBWSu1b2cSGAE="}],"stop_reason":null,"stop_sequence":null,"stop_details":null,"usage":{"input_tokens":3,"cache_creation_input_tokens":16531,"cache_read_input_tokens":16918,"cache_creation":{"ephemeral_5m_input_tokens":16531,"ephemeral_1h_input_tokens":0},"output_tokens":7,"service_tier":"standard","inference_geo":"global"},"diagnostics":null,"context_management":null},"parent_tool_use_id":null,"session_id":"ce38714c-16fc-4b0e-9351-3b1b9b86a969","uuid":"cbd738ab-dd2a-40bf-b4bf-95bcb6ae5d94","timestamp":"2026-07-17T08:48:11.274Z","request_id":"req_011Cd7LgRaN67h8UAuELn2sQ"}';

export const TOOL_USE_SKILL =
  '{"type":"assistant","message":{"model":"claude-sonnet-4-6","id":"msg_011Cd7LgS7cHZ15UPtj7SZrN","type":"message","role":"assistant","content":[{"type":"tool_use","id":"toolu_01WDU8z61jyUZdGDcu8fa1s1","name":"Skill","input":{"skill":"review","args":"871 re-cinq/lore"},"caller":{"type":"direct"}}],"stop_reason":null,"stop_sequence":null,"stop_details":null,"usage":{"input_tokens":3,"cache_creation_input_tokens":16531,"cache_read_input_tokens":16918,"cache_creation":{"ephemeral_5m_input_tokens":16531,"ephemeral_1h_input_tokens":0},"output_tokens":7,"service_tier":"standard","inference_geo":"global"},"diagnostics":null,"context_management":null},"parent_tool_use_id":null,"session_id":"ce38714c-16fc-4b0e-9351-3b1b9b86a969","uuid":"9c3eac58-4a62-4f8b-892d-2264510f2f78","timestamp":"2026-07-17T08:48:11.520Z","request_id":"req_011Cd7LgRaN67h8UAuELn2sQ"}';

export const USER_PROMPT =
  '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Review target: GitHub pull request `871`.\\n\\nGather this target\'s diff with (instead of any local `git diff`):\\n1. `gh pr view 871 --json title,body,author,baseRefName,headRefName,state,additions,deletions,changedFiles,labels` for context\\n2. `gh pr diff 871` for the unified diff\\n\\nThe PR\'s diff is the only review scope — local working-tree changes are out of scope. When you need surrounding code, Read the files in this checkout if it matches the PR\'s branch, otherwise fetch file contents via `gh`.\\n\\nAdditional instructions from the user: re-cinq/lore\\n\\nAnalyze the changes and provide a thorough code review that includes:\\n- An overview of what the PR does\\n- Analysis of code quality and style\\n- Specific suggestions for improvements\\n- Any potential issues or risks\\n\\nKeep your review concise but thorough. Focus on:\\n- Code correctness\\n- Following project conventions\\n- Performance implications\\n- Test coverage\\n- Security considerations\\n\\nFormat your review with clear sections and bullet points."}]},"parent_tool_use_id":null,"session_id":"ce38714c-16fc-4b0e-9351-3b1b9b86a969","uuid":"0cefb443-7e80-4d75-a391-bbc427f467ee","timestamp":"2026-07-17T08:48:11.538Z","isSynthetic":true}';

export const ASSISTANT_TEXT =
  '{"type":"assistant","message":{"model":"claude-sonnet-4-6","id":"msg_011Cd7Lgg6jVeJWiyTaopvnq","type":"message","role":"assistant","content":[{"type":"text","text":"I\'ll fetch the PR metadata and diff to conduct a thorough review."}],"stop_reason":null,"stop_sequence":null,"stop_details":null,"usage":{"input_tokens":3,"cache_creation_input_tokens":390,"cache_read_input_tokens":33449,"cache_creation":{"ephemeral_5m_input_tokens":390,"ephemeral_1h_input_tokens":0},"output_tokens":7,"service_tier":"standard","inference_geo":"global"},"diagnostics":null,"context_management":null},"parent_tool_use_id":null,"session_id":"ce38714c-16fc-4b0e-9351-3b1b9b86a969","uuid":"b3bfdf42-53a8-4e70-94c1-407a7084afe1","timestamp":"2026-07-17T08:48:13.999Z","request_id":"req_011Cd7LgfTHwn2NM4dXi5zsc"}';

export const TOOL_USE_BASH =
  '{"type":"assistant","message":{"model":"claude-sonnet-4-6","id":"msg_011Cd7Lgg6jVeJWiyTaopvnq","type":"message","role":"assistant","content":[{"type":"tool_use","id":"toolu_01MpZuAEpNbxLxPJ9f7RKNWh","name":"Bash","input":{"command":"gh pr view 871 --repo re-cinq/lore --json title,body,author,baseRefName,headRefName,state,additions,deletions,changedFiles,labels 2>&1"},"caller":{"type":"direct"}}],"stop_reason":null,"stop_sequence":null,"stop_details":null,"usage":{"input_tokens":3,"cache_creation_input_tokens":390,"cache_read_input_tokens":33449,"cache_creation":{"ephemeral_5m_input_tokens":390,"ephemeral_1h_input_tokens":0},"output_tokens":7,"service_tier":"standard","inference_geo":"global"},"diagnostics":null,"context_management":null},"parent_tool_use_id":null,"session_id":"ce38714c-16fc-4b0e-9351-3b1b9b86a969","uuid":"c96a0a13-04e8-4206-b8ee-58f97018d555","timestamp":"2026-07-17T08:48:14.923Z","request_id":"req_011Cd7LgfTHwn2NM4dXi5zsc"}';

export const TOOL_RESULT_OK =
  '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_01WDU8z61jyUZdGDcu8fa1s1","content":"Launching skill: review"}]},"parent_tool_use_id":null,"session_id":"ce38714c-16fc-4b0e-9351-3b1b9b86a969","uuid":"f533e058-3a4a-4556-80d4-146ec90186bf","timestamp":"2026-07-17T08:48:11.541Z","tool_use_result":{"success":true,"commandName":"review"}}';

export const TOOL_RESULT_ERROR =
  '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"Exit code 127\\n/bin/bash: line 1: gh: command not found","is_error":true,"tool_use_id":"toolu_01MpZuAEpNbxLxPJ9f7RKNWh"}]},"parent_tool_use_id":null,"session_id":"ce38714c-16fc-4b0e-9351-3b1b9b86a969","uuid":"fec39e09-5151-4f0e-ae6c-3c1047427da0","timestamp":"2026-07-17T08:48:15.098Z","tool_use_result":"Error: Exit code 127\\n/bin/bash: line 1: gh: command not found"}';

export const TOOL_RESULT_ARRAY =
  '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_01RgyHaFrFWBTwWiWFZfmM5x","content":[{"type":"tool_reference","tool_name":"WebFetch"}]}]},"parent_tool_use_id":null,"session_id":"ce38714c-16fc-4b0e-9351-3b1b9b86a969","uuid":"7a65acfa-b5dd-4427-926a-3c559ea5d3d5","timestamp":"2026-07-17T08:48:18.553Z","tool_use_result":{"matches":["WebFetch"],"query":"select:WebFetch","total_deferred_tools":18}}';

export const RESULT_TERMINAL =
  '{"type":"result","subtype":"success","is_error":false,"api_error_status":null,"duration_ms":201372,"duration_api_ms":200468,"ttft_ms":3321,"ttft_stream_ms":1695,"time_to_request_ms":208,"num_turns":27,"result":"```REVIEW_FINDINGS\\n{\\n  \\"verdict\\": \\"approved\\",\\n  \\"summary\\": \\"Clean FR5 implementation — routes post-ingest validate through the shared cron handler; no blocking issues\\",\\n  \\"findings\\": [\\n    {\\n      \\"path\\": \\"apps/floor/src/main-loop/registry.test.ts\\",\\n      \\"line\\": 43,\\n      \\"label\\": \\"nit\\",\\n      \\"subject\\": \\"Avoid building the registry twice for a single comparison\\",\\n      \\"body\\": \\"Two `buildRegistry()` calls create two separate Map instances; a shared binding is cleaner and ensures no surprising re-initialisation cost.\\",\\n      \\"suggestion\\": \\"  it(\\\\\\"routes the post-ingest validate event through the detect tick (one substrate, FR5)\\\\\\", () => {\\\\n    // The same production handler serves the weekly cron and the post-ingest\\\\n    // trigger: params.repo narrows it to the one repo, and the validate core\\\\n    // runs in the detect station pod either way — never inline in the Floor.\\\\n    const r = buildRegistry();\\\\n    expect(r.get(\\\\\\"internal.ingest.spec_coverage_validate\\\\\\")).toBe(\\\\n      r.get(\\\\\\"cron.spec_coverage_validate.tick\\\\\\"),\\\\n    );\\\\n  });\\"\\n    },\\n    {\\n      \\"path\\": \\"apps/floor/src/main-loop/registry.ts\\",\\n      \\"line\\": 70,\\n      \\"label\\": \\"nit\\",\\n      \\"subject\\": \\"Trim the 3-line comment to one line (CLAUDE.md: one short line max)\\",\\n      \\"body\\": \\"CLAUDE.md says \'one short line max\' for WHY-comments. The cross-reference to the spec is already carried by the validated-by link in specs/ingest-station/spec.md, so the inline comment just needs the invariant.\\",\\n      \\"suggestion\\": \\"    // FR5: shares the cron handler — params.repo narrows fan-out to one repo, core runs in station pod.\\\\n    [\\\\\\"internal.ingest.spec_coverage_validate\\\\\\", detect.specCoverageValidateTick],\\"\\n    },\\n    {\\n      \\"path\\": \\"specs/ingest-station/spec.md\\",\\n      \\"line\\": 80,\\n      \\"label\\": \\"nit\\",\\n      \\"subject\\": \\"Fix `implemented by` link — points to comment line 70, not the binding at line 73\\",\\n      \\"body\\": \\"The `[implemented by registry.ts:70]` link lands on the comment, not the Map entry at line 73. Spec tooling renders the line number as the descriptor; pointing at the comment is misleading.\\",\\n      \\"suggestion\\": \\"  ([validated by `registry.test.ts:39`](apps/floor/src/main-loop/registry.test.ts#L39); implemented by [`registry.ts:73`](apps/floor/src/main-loop/registry.ts#L73))\\"\\n    },\\n    {\\n      \\"path\\": \\"apps/floor/src/main-loop/registry.ts\\",\\n      \\"line\\": 73,\\n      \\"label\\": \\"thought\\",\\n      \\"subject\\": \\"Missing `params.repo` now fans out to all spec repos instead of failing fast\\",\\n      \\"body\\": \\"The old `internal.specCoverageValidate` would crash or pass undefined to `validateSpecCoverageJob` if `params.repo` was absent. The new path\'s `createDetectTickHandler` silently fans out to every `specRepos()` repo when the field is missing or empty (fan-out.ts:99-101). In practice the mcp-server always supplies `params.repo`, and the overlap-guard prevents true duplicates, but the blast-radius on a malformed event is wider. No action needed unless you want an explicit guard.\\"\\n    },\\n    {\\n      \\"path\\": \\"apps/lore-station/src/stations/validate.ts\\",\\n      \\"line\\": 1,\\n      \\"label\\": \\"thought\\",\\n      \\"subject\\": \\"FR6 / AC5 (SERIAL_FAMILIES empty) still open after this PR\\",\\n      \\"body\\": \\"Acceptance Criterion 5 requires `SERIAL_FAMILIES` to be empty and no `internal.ingest.*` handler to call `createDgraphClient()`. This PR correctly claims only FR5 — `specTrace` still writes dgraph inline and `SERIAL_FAMILIES` still contains `internal.ingest.spec_trace`. Worth a follow-on task once FRs 1–4, 6–7 land so the spec status can flip to Implemented.\\"\\n    },\\n    {\\n      \\"path\\": \\"apps/floor/src/main-loop/registry.test.ts\\",\\n      \\"line\\": 39,\\n      \\"label\\": \\"praise\\",\\n      \\"subject\\": \\"Reference-equality assertion (`toBe`) is the right tool to lock this invariant\\",\\n      \\"body\\": \\"Using `toBe` rather than `toEqual` proves the two event names are wired to the *same function object* — exactly the \'one substrate\' architectural invariant FR5 demands. Clean.\\"\\n    }\\n  ]\\n}\\n```\\n\\nREVIEW_RESULT:APPROVED","stop_reason":"end_turn","session_id":"ce38714c-16fc-4b0e-9351-3b1b9b86a969","total_cost_usd":0.5066994499999999,"usage":{"input_tokens":106,"cache_creation_input_tokens":47123,"cache_read_input_tokens":651774,"output_tokens":8221,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":47123},"inference_geo":"global","iterations":[{"input_tokens":1,"output_tokens":1641,"cache_read_input_tokens":59536,"cache_creation_input_tokens":4505,"cache_creation":{"ephemeral_5m_input_tokens":4505,"ephemeral_1h_input_tokens":0},"type":"message"}],"speed":"standard"},"modelUsage":{"claude-haiku-4-5-20251001":{"inputTokens":10713,"outputTokens":22,"cacheReadInputTokens":0,"cacheCreationInputTokens":0,"webSearchRequests":0,"costUSD":0.010823000000000001,"contextWindow":200000,"maxOutputTokens":32000},"claude-sonnet-4-6":{"inputTokens":106,"outputTokens":8221,"cacheReadInputTokens":651774,"cacheCreationInputTokens":47123,"webSearchRequests":0,"costUSD":0.4958764499999999,"contextWindow":200000,"maxOutputTokens":32000}},"permission_denials":[],"terminal_reason":"completed","fast_mode_state":"off","uuid":"b256b67b-e196-4189-b90e-78b63118c1dd"}';

export const LIFECYCLE_SUCCEEDED =
  '{"kind":"lifecycle","exitCode":0,"phase":"agent","status":"succeeded"}';

// The exact serialized output of eventLine() / resultLine() in
// libs/assembly-lines/src/agent-output.ts (web-ui cannot import that lib).
export const STATION_LOG =
  '{"type":"log","message":"detect: scanning 42 specs"}';

export const NODE_RESULT_LINE =
  '{"type":"result","is_error":false,"result":"LORE_NODE_RESULT: {\\"outcome\\":\\"success\\",\\"extras\\":{}}"}';

export const RUNNER_MARKER =
  "[runner] Reusing cached repo at /workspace/repo (fetch)";

// The ai-agent-subsystem's attribution envelope (ADR-031 D8) — single and the
// transitional double wrap both appear in prod streams.
export function wrapped(line: string): string {
  return JSON.stringify({ source: { task: "t1" }, event: JSON.parse(line) });
}

export function doubleWrapped(line: string): string {
  return wrapped(wrapped(line));
}

export const SAMPLE_LOG = [
  LIFECYCLE_STARTED,
  SESSION_INIT,
  THINKING_TOKENS_11,
  THINKING_TOKENS_21,
  ASSISTANT_THINKING,
  TOOL_USE_SKILL,
  TOOL_RESULT_OK,
  USER_PROMPT,
  THINKING_TOKENS_444,
  ASSISTANT_TEXT,
  TOOL_USE_BASH,
  TOOL_RESULT_ERROR,
  RUNNER_MARKER,
  STATION_LOG,
  RESULT_TERMINAL,
  LIFECYCLE_SUCCEEDED,
].join("\n");
