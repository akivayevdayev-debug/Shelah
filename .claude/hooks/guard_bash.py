#!/usr/bin/env python3
"""Blocks shell commands this repo's rules forbid, before they run.

Claude Code PreToolUse hook for Bash: reads the tool call as JSON on stdin;
exit code 2 blocks the command and shows stderr to the agent.

Blocked:
  - commit messages with a Co-Authored-By trailer or a "Generated with" line
    (commits are authored by the repo owner alone)
  - `npm ci` and deleting node_modules (use `npm install`)
  - deleting the project folder itself
  - staging DECISIONS.md or an iCloud conflict copy ("name 2.ext")
  - `git add -A` / `git add .` / `git commit -a` (the checkout is shared with
    other sessions: stage the files you changed by name)
"""
import json
import re
import sys

# Checked against the whole command, commit message included.
MESSAGE_RULES = [
    (r"\bgit\s+commit\b.*co-authored-by", "Commits are authored by the repo owner alone: drop the Co-Authored-By trailer."),
    (r"\bgit\s+(commit|push)\b.*generated with \[?claude", 'Drop the "Generated with Claude Code" line.'),
]

# Checked with commit messages and heredoc bodies taken out, so a message
# that mentions `npm ci` or `git add -A` in prose is not mistaken for one.
RULES = [
    (r"\bnpm\s+ci\b", "Use `npm install`, never `npm ci`."),
    (r"\brm\s+-\w*r\w*\s+[^;&|]*node_modules", "Never delete node_modules."),
    (r"\brm\s+-\w*r\w*\s+[^;&|]*sh'?elah_app/?[\"']?\s*($|[;&|])", "Never delete the Sh'elah_app folder."),
    (r"\bgit\s+add\b[^;&|]*\bdecisions\.md\b", "Never commit DECISIONS.md (it is skip-worktree on purpose)."),
    (r"\bgit\s+add\b[^;&|]*\s[0-9]\.[a-z0-9]+[\"']", 'Never commit iCloud conflict copies ("name 2.ext").'),
    (r"\bgit\s+add\s+(-A|--all|\.)(\s|$|[;&|])", "Stage the files you changed by name; the checkout is shared."),
    (r"\bgit\s+commit\b[^;&|]*\s-(a|am)\b", "No `git commit -a`: stage the files you changed by name."),
]


HEREDOC_RE = re.compile(r"<<-?\s*['\"]?(\w+)['\"]?[^\n]*\n.*?\n\1(?=\s|$)", re.DOTALL)
MESSAGE_ARG_RE = re.compile(r"(-m|--message|-F)(\s+|=)(\"(?:[^\"\\]|\\.)*\"|'[^']*')")


def without_messages(command: str) -> str:
    return MESSAGE_ARG_RE.sub(r"\1 msg", HEREDOC_RE.sub("<<msg", command))


def blocked(command: str):
    for pattern, message in MESSAGE_RULES:
        if re.search(pattern, command, re.IGNORECASE | re.DOTALL):
            return message
    stripped = without_messages(command)
    for pattern, message in RULES:
        if re.search(pattern, stripped, re.IGNORECASE):
            return message
    return None


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        return 0
    message = blocked(str((payload.get("tool_input") or {}).get("command") or ""))
    if message:
        print(f"Blocked by .claude/hooks/guard_bash.py: {message}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
