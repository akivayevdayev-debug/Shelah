"""Blind, criteria-based readability judging of two `eval_ai_quality.py style` runs
(docs/evals/2026-10-22-plain-language.md).

For each question the "before" and "after" answers are shown to claude-haiku-5-5 as A
and B in a seeded order, with no hint of which is which. The judge scores each
on five criteria (1 = poor, 5 = excellent) and says which one an adult who has never
studied the subject would find easier to read. Only the scores and the order are kept.

Reads build/eval/before.json and build/eval/after.json (two `eval_ai_quality.py style
--save` runs, each renamed after it finishes); --save writes build/eval/judged.json. The
paths are constants, not arguments.

    SHELAH_ENV_FILE=/path/to/.env .venv/bin/python scripts/judge_readability.py [--save] [--seed N]
"""

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(os.environ.get("SHELAH_ENV_FILE", ".env"), override=False)

MODEL = "claude-haiku-5-5"
CRITERIA = {
    "plain_words": "everyday words, no formal or academic vocabulary",
    "short_sentences": "short sentences with one idea each",
    "terms_explained": "every Hebrew or Aramaic term is explained the first time it appears",
    "consistent_spelling": "each name and term is spelled one way throughout",
    "no_padding": "no filler, restatement or decoration",
}
PROMPT = """You are judging two answers (A and B) to the same question for readability by an adult who has never studied Jewish texts. Judge only the writing, not whether the content is right.

Question: {question}

--- Answer A ---
{a}

--- Answer B ---
{b}

Score each answer from 1 (poor) to 5 (excellent) on these criteria:
{criteria}

Reply with JSON only, in this shape:
{{"A": {{{keys}}}, "B": {{{keys}}}, "easier": "A" or "B" or "same"}}"""


def judge(client, key, question, a, b):
    keys = ", ".join(f'"{name}": 1-5' for name in CRITERIA)
    prompt = PROMPT.format(
        question=question, a=a, b=b, keys=keys,
        criteria="\n".join(f"- {name}: {text}" for name, text in CRITERIA.items()))
    for _ in range(3):
        response = client.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
            json={"model": MODEL, "max_tokens": 3000, "output_config": {"effort": "low"},
                  "messages": [{"role": "user", "content": prompt}]},
            timeout=90,
        )
        response.raise_for_status()
        text = "".join(block.get("text", "") for block in response.json().get("content", []))
        try:
            return json.loads(text[text.index("{"):text.rindex("}") + 1])
        except ValueError:  # JSONDecodeError and a reply with no braces both land here
            continue
    raise RuntimeError("the judge did not return JSON three times in a row")


EVAL_DIR = Path(__file__).resolve().parent.parent / "build" / "eval"
BEFORE_PATH = EVAL_DIR / "before.json"
AFTER_PATH = EVAL_DIR / "after.json"
JUDGED_PATH = EVAL_DIR / "judged.json"


def new_answer_is_a(seed, question):
    """Which side the new answer is shown on: a fixed coin per (seed, question)."""
    return hashlib.sha256(f"{seed}:{question}".encode()).digest()[0] < 128


def pairs(before, after):
    for group in ("questions", "flagged_thread"):
        for old, new in zip(before.get(group, []), after.get(group, [])):
            if old.get("answer") and new.get("answer") and not old.get("refused") and not new.get("refused"):
                yield old["question"], old["answer"], new["answer"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--save", action="store_true", help="write build/eval/judged.json")
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        sys.exit("ANTHROPIC_API_KEY is not set")
    with open(BEFORE_PATH, encoding="utf-8") as handle:
        before = json.load(handle)
    with open(AFTER_PATH, encoding="utf-8") as handle:
        after = json.load(handle)
    rows, totals = [], {"before": dict.fromkeys(CRITERIA, 0), "after": dict.fromkeys(CRITERIA, 0)}
    wins = {"before": 0, "after": 0, "same": 0}
    with httpx.Client() as client:
        for question, old, new in pairs(before, after):
            swapped = new_answer_is_a(args.seed, question)
            a, b = (new, old) if swapped else (old, new)
            verdict = judge(client, key, question, a, b)
            new_side, old_side = ("A", "B") if swapped else ("B", "A")
            for name in CRITERIA:
                totals["after"][name] += int(verdict[new_side][name])
                totals["before"][name] += int(verdict[old_side][name])
            easier = verdict.get("easier")
            if easier not in ("A", "B"):
                wins["same"] += 1
            elif easier == new_side:
                wins["after"] += 1
            else:
                wins["before"] += 1
            rows.append({"question": question, "after_was": new_side, "verdict": verdict})
    count = len(rows)
    summary = {
        "answers_judged": count,
        "mean_score": {side: {n: round(v / count, 2) for n, v in totals[side].items()} for side in totals},
        "easier_to_read": wins,
    }
    print(json.dumps(summary, indent=1))
    if args.save:
        with open(JUDGED_PATH, "w", encoding="utf-8") as handle:
            json.dump({"summary": summary, "rows": rows}, handle, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
