# Feature Specification: Explain Code From Its Specs

| Field   | Value                          |
| ------- | ------------------------------ |
| Feature | Explain Code From Its Specs    |
| Branch  | vscode-extension-local-install |
| Status  | Shipped                        |
| Created | 2026-11-05                     |
| Owner   | Platform Engineering           |

A developer reading unfamiliar code, or an agent about to change it, asks what a span of lines is for. Lore answers from the spec statements linked to those lines, in at most two paragraphs, and says it does not know when no statement links them: an explanation guessed from the code alone would read as authoritative while resting on nothing. The same answer reaches an agent through the `lore_explain_code` MCP tool and a person through the VS Code extension's "Lore: What does this do?" context-menu entry.

## Finding the statements

- A statement validated by a test declared within the selected lines reaches them. ([validated by returns the statement a test declared in the selected lines validates @5bb84c79](libs/shared/src/outbound/spec-trace/statements-at.test.ts#L92))
- A statement whose spec links a code chunk within the selected lines as its implementation reaches them. ([validated by returns the statement a code chunk in the selected lines implements @a484eec0](libs/shared/src/outbound/spec-trace/statements-at.test.ts#L113))
- A statement validated by a test whose recorded coverage overlaps the selected lines reaches them. ([validated by returns the statement of a test whose coverage overlaps the selected lines @eec32396](libs/shared/src/outbound/spec-trace/statements-at.test.ts#L140))
- Lines no statement reaches have no statements. ([validated by returns nothing for lines no statement reaches @d3e9fc95](libs/shared/src/outbound/spec-trace/statements-at.test.ts#L165))

## The explain route

- `POST /api/repos/:owner/:repo/explain` reads the statements for the posted file and line span of that repository. ([validated by reads the statements for the selected span of the repo's file @ad1e9255](apps/lore-api/src/transport/routes/explain/explain-code.test.ts#L90))
- When statements reach the span, the route answers the model's explanation together with those statements and the model's name. ([validated by answers the model's explanation with the statements that link the lines @75631f47](apps/lore-api/src/transport/routes/explain/explain-code.test.ts#L45))
- The model is given the file path, the line span, every reaching statement and the selected code. ([validated by asks the model with the statements, the path and the code @f3e72cd2](apps/lore-api/src/transport/routes/explain/explain-code.test.ts#L77))
- When no statement reaches the span, the route answers "I don't know" and calls no model. ([validated by answers I don't know without calling the model when no statement links the lines @8e7245b6](apps/lore-api/src/transport/routes/explain/explain-code.test.ts#L63))
- A span whose end line is before its start line is refused with 400. ([validated by answers 400 when the end line is before the start line @8bf968b6](apps/lore-api/src/transport/routes/explain/explain-code.test.ts#L109))

## The MCP tool

- `lore_explain_code` posts the repository, file path, line span and code to the explain route. ([validated by posts the span and the code to the repo's explain route @da1f1dd7](apps/mcp-server/src/transport/tools/spec-trace/explain-code.test.ts#L60))
- The tool answers the explanation followed by the statements it rests on. ([validated by answers the explanation followed by the statements it rests on @21e2359d](apps/mcp-server/src/transport/tools/spec-trace/explain-code.test.ts#L26))
- When no statement links the lines, the tool answers the "I don't know" text alone. ([validated by answers I don't know alone when no statement links the lines @927b92d1](apps/mcp-server/src/transport/tools/spec-trace/explain-code.test.ts#L46))
- On a developer's machine, a call without code reads the selected lines from the checkout. ([validated by reads lines 1-2 of package.json from the checkout when no code is given @4bcf7f78](apps/mcp-server/src/transport/tools/spec-trace/explain-code.test.ts#L85))
- When the file is not in the checkout and no code is given, the tool asks for the code. ([validated by asks for the code when the file is not in the checkout @7abfbefb](apps/mcp-server/src/transport/tools/spec-trace/explain-code.test.ts#L100))

## The VS Code command

- The extension posts the selected span and code to the explain route and reads back the explanation. ([validated by posts the span and code to the explain route and returns the explanation @165535c9](apps/vscode-extension/src/lore-client.test.ts#L116))
- The hover shows the answer, then each statement it rests on with how it reaches the lines. ([validated by renders the answer, then the statement it rests on with how it reaches the lines @94510589](apps/vscode-extension/src/explain-view.test.ts#L13))
- When no statement links the lines, the hover shows the answer alone. ([validated by renders the answer alone when no statement links the lines @2ad486ac](apps/vscode-extension/src/explain-view.test.ts#L28))
- The hover lists at most three statements and counts the rest. ([validated by lists 3 of 5 statements and says 2 more @87a285d6](apps/vscode-extension/src/explain-view.test.ts#L32))
- An answer is cached by its file and exact code, so the same code is never asked about twice. ([validated by finds the explanation saved for src/w.ts and the same code @88d51205](apps/vscode-extension/src/explain-store.test.ts#L31), [validated by keeps one entry when the same code is saved twice @81c3f9c7](apps/vscode-extension/src/explain-store.test.ts#L47))
- Code that changed has no cached answer, and its hint goes away. ([validated by finds nothing once the code differs by one character @3eafcc25](apps/vscode-extension/src/explain-store.test.ts#L39), [validated by drops code that changed @b730f20d](apps/vscode-extension/src/explain-store.test.ts#L100))
- The cache survives a restart of the editor. ([validated by reads entries a previous session saved to the same store @7affbc0f](apps/vscode-extension/src/explain-store.test.ts#L56))
- The hint follows its code when the code moves within the file, and sits only where the code starts a line. ([validated by follows code that moved down two lines @461cb200](apps/vscode-extension/src/explain-store.test.ts#L94), [validated by places code found at lines 2-3 on lines 2-3 @949b94f5](apps/vscode-extension/src/explain-store.test.ts#L88), [validated by matches code only where a line starts @7be54477](apps/vscode-extension/src/explain-store.test.ts#L104), [validated by places two entries of one file @a72e7ba0](apps/vscode-extension/src/explain-store.test.ts#L110))
- The cache keeps the 300 newest answers, dropping the oldest first. ([validated by drops the oldest entry when a third is saved over a limit of 2 @1dfb4050](apps/vscode-extension/src/explain-store.test.ts#L66))

## Background

The command sits on the editor's context menu. A selection is widened to whole lines, and with nothing selected it explains the cursor's line. While the answer is on its way, a spinner sits in the gutter beside the span's first line; then a hint icon takes its place, dimmed when the answer is "I don't know", and hovering the span shows the answer. A failed request removes the spinner and says why. The cache lives in the editor's global state, and only answers whose exact code still sits in the file are drawn. The model is `Llm.for("explain")`, chosen per deployment like every other use (`LORE_EXPLAIN_LLM_PROVIDER`, `LORE_EXPLAIN_LLM_MODEL`). Only main's graph is read: a statement a branch adds reaches its lines after the branch merges and CI ingests it.
