"""The Bash guard hook (.claude/hooks/guard_bash.py) blocks what the repo's
rules forbid and lets ordinary commands through."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

HOOK = Path(__file__).resolve().parent.parent / ".claude" / "hooks" / "guard_bash.py"

TRAILER = "Co-" + "Authored-By: Someone <a@b.c>"

BLOCKED = [
    f'git commit -m "fix" -m "{TRAILER}"',
    f"git commit -q -F - <<EOF\nfix\n\n{TRAILER}\nEOF",
    "npm ci",
    "rm -rf node_modules",
    "rm -rf \"/Users/a/Documents/Sh'elah_app\"",
    'git add "tests/_alias_httpx 2.py"',
    "git add DECISIONS.md",
    "git add -A",
    "git add .",
    'git commit -am "wip"',
]

ALLOWED = [
    'git log --grep "Co-' + 'Authored-By"',
    "git commit --amend --no-edit",
    'git add static/js/shell.js && git commit -q -m "fix(a): b -- and more"',
    "npm install",
    "rm -rf \"/Users/a/Documents/Sh'elah_app/build/tmp\"",
    "git commit -q -F - <<'EOF'\nchore: block npm " + "ci and git add -A\nEOF",
    'git commit -m "docs: never run npm ' + 'ci"',
]


def _exit_code(command: str) -> int:
    payload = json.dumps({"tool_input": {"command": command}})
    return subprocess.run(
        [sys.executable, str(HOOK)], input=payload, text=True, capture_output=True, check=False
    ).returncode


@pytest.mark.parametrize("command", BLOCKED)
def test_blocks_forbidden_commands(command):
    assert _exit_code(command) == 2


@pytest.mark.parametrize("command", ALLOWED)
def test_allows_ordinary_commands(command):
    assert _exit_code(command) == 0
