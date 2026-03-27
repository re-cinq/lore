#!/usr/bin/env python3
"""Generate a Spec Kit constitution from Lore MCP context.

Calls the MCP server's get_context and get_adrs tools, then renders
the results as .specify/constitution.md.

Usage: lore-gen-constitution --team payments
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

AVAILABLE_TEAMS = ["payments", "platform", "mobile", "data"]


def call_mcp_tool(tool_name: str, arguments: dict) -> str:
    """Call an MCP tool via the local server and return the text result."""
    context_path = os.environ.get(
        "CONTEXT_PATH", os.path.expanduser("~/.re-cinq/lore")
    )
    server_path = os.path.join(context_path, "mcp-server", "dist", "index.js")

    if not os.path.exists(server_path):
        print(
            f"Error: MCP server not found at {server_path}\n"
            "Fix: run install.sh to build the MCP server",
            file=sys.stderr,
        )
        sys.exit(1)

    # Build JSON-RPC request
    request = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments},
    })

    try:
        result = subprocess.run(
            ["node", server_path],
            input=request,
            capture_output=True,
            text=True,
            timeout=10,
            env={**os.environ, "CONTEXT_PATH": context_path},
        )
        # Parse response — look for content in the output
        for line in result.stdout.strip().split("\n"):
            try:
                msg = json.loads(line)
                if "result" in msg and "content" in msg["result"]:
                    return msg["result"]["content"][0]["text"]
            except (json.JSONDecodeError, KeyError, IndexError):
                continue
        return result.stdout
    except subprocess.TimeoutExpired:
        print("Error: MCP server timed out", file=sys.stderr)
        sys.exit(1)
    except FileNotFoundError:
        print("Error: node not found. Install Node.js first.", file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="Generate Spec Kit constitution from Lore context"
    )
    parser.add_argument(
        "--team",
        required=True,
        choices=AVAILABLE_TEAMS,
        help="Team name",
    )
    args = parser.parse_args()

    # Get context and ADRs
    context = call_mcp_tool("get_context", {"team": args.team})
    adrs = call_mcp_tool("get_adrs", {"domain": args.team})

    # Check for existing constitution
    output_path = Path(".specify/constitution.md")
    if output_path.exists():
        answer = input(
            f"{output_path} already exists. Overwrite? [y/N] "
        ).strip().lower()
        if answer != "y":
            print("Aborted.")
            sys.exit(0)

    # Render constitution
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        f"# Project Constitution\n\n"
        f"Generated from Lore context for team: {args.team}\n\n"
        f"## Team Conventions\n\n{context}\n\n"
        f"## Active Architecture Decisions\n\n{adrs}\n"
    )
    print(f"[lore] Constitution written to {output_path}")


if __name__ == "__main__":
    main()
