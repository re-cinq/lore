---
adr_number: "008"
title: AST-based code chunking via web-tree-sitter
status: accepted
date: 2026-04-01
domains:
  - architecture
  - ingestion
  - search
---

# AST-based code chunking via web-tree-sitter

## Status

Accepted

## Context

Lore stored entire files as single chunks, truncated at 8,000 characters before embedding. The constitution (Principle 8) required "code: functions/classes split at AST boundaries" but no parsing existed. This produced low-quality search results where a query for a specific function returned the entire file (or a truncated portion of it).

## Decision

Add `web-tree-sitter` (WASM-based, no native dependencies) to both the MCP server and Lore Agent. Code files are parsed at top-level declaration boundaries (functions, classes, interfaces, types). Doc/spec/ADR files are split on `## ` heading boundaries. Unsupported languages fall back to sliding-window chunking (400 lines, 50-line overlap).

## Rationale

- **Symbol-level chunks** produce targeted search results (a specific function, not the whole file)
- **AST metadata** (symbol_name, symbol_type, start_line, end_line) enables spec drift detection
- **WASM-based tree-sitter** works in Node.js without native build dependencies
- **Graceful fallback** ensures ingestion never breaks for unsupported languages

## Supersedes

- The 8k character truncation in ingest.ts and reindex.ts

## Alternatives Considered

### 1. Native tree-sitter

Better performance but requires native compilation (node-gyp), which complicates Docker builds and CI. WASM is ~2x slower but dependency-free.

### 2. Regex-based splitting

Simpler but unreliable — misses nested structures, closures, and multi-line signatures.

### 3. LLM-based chunking

Send file to LLM and ask for boundaries. Expensive, slow, and adds API dependency to the ingestion pipeline.
