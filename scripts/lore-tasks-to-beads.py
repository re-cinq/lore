#!/usr/bin/env python3
"""Convert Spec Kit tasks.md into Beads tasks with dependencies.

Parses the task markdown format, creates bd tasks, and wires up
dependencies from [DEPENDS ON: ...] markers.

Usage: lore-tasks-to-beads .specify/tasks.md
"""

import re
import shutil
import subprocess
import sys
from pathlib import Path

# Matches: - [ ] T001 [P] [US1] Description...
TASK_RE = re.compile(
    r"^- \[ \] (T\d+)\s*"
    r"(?:\[P\]\s*)?"
    r"(?:\[US\d+\]\s*)?"
    r"(.+)$"
)
DEPENDS_RE = re.compile(r"\[DEPENDS ON:\s*([^\]]+)\]")


def check_bd():
    if not shutil.which("bd"):
        print(
            "Error: bd CLI not found.\n"
            "Fix: npm install -g @beads/bd",
            file=sys.stderr,
        )
        sys.exit(1)

    # Auto-init Beads if not yet initialized in cwd
    if not Path(".beads").exists():
        print("[lore] Beads not initialized, running bd init...")
        subprocess.run(["bd", "init"], capture_output=True)



def run_bd(args: list[str]) -> str:
    result = subprocess.run(
        ["bd"] + args,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 and "already exists" not in result.stderr:
        print(f"bd error: {result.stderr.strip()}", file=sys.stderr)
    return result.stdout.strip()


def parse_tasks(content: str) -> list[dict]:
    tasks = []
    for line in content.split("\n"):
        match = TASK_RE.match(line.strip())
        if match:
            task_id = match.group(1)
            description = match.group(2).strip()
            deps_match = DEPENDS_RE.search(description)
            deps = []
            if deps_match:
                deps = [d.strip() for d in deps_match.group(1).split(",")]
                description = DEPENDS_RE.sub("", description).strip()
            tasks.append({
                "id": task_id,
                "title": f"{task_id}: {description}",
                "deps": deps,
            })
    return tasks


def main():
    if len(sys.argv) < 2:
        print("Usage: lore-tasks-to-beads <tasks.md>", file=sys.stderr)
        sys.exit(1)

    tasks_path = Path(sys.argv[1])
    if not tasks_path.exists():
        print(f"Error: {tasks_path} not found", file=sys.stderr)
        sys.exit(1)

    check_bd()

    content = tasks_path.read_text()
    tasks = parse_tasks(content)

    if not tasks:
        print("No tasks found in file.", file=sys.stderr)
        sys.exit(1)

    print(f"[lore] Creating {len(tasks)} Beads tasks...")

    # Track created task IDs (bd id -> spec task id)
    created = {}
    for task in tasks:
        output = run_bd(["create", task["title"]])
        # Extract bd task ID from output
        bd_id = output.split()[-1] if output else task["id"]
        created[task["id"]] = bd_id
        print(f"  {task['id']} -> {bd_id}")

    # Wire dependencies
    dep_count = 0
    for task in tasks:
        if task["deps"]:
            child_id = created.get(task["id"], task["id"])
            for dep in task["deps"]:
                parent_id = created.get(dep, dep)
                run_bd(["dep", "add", child_id, parent_id])
                dep_count += 1

    print(f"[lore] Done. {len(tasks)} tasks created, {dep_count} dependencies wired.")
    print("[lore] Run 'bd ready' to see unblocked tasks.")


if __name__ == "__main__":
    main()
