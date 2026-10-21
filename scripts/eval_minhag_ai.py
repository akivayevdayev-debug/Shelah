"""Live eval of the community setting in AI answers (docs/evals/2026-10-20-minhag-ai.md).

For a few questions and each lens the site's community setting sends
(Sefardic, Iraqi = Mizrahi, Ashkenaz), asks the real models through
backend.claude.ask_claude and reports whether the answer names the community
it follows and whether it uses Ashkenazi transliterations
(backend.minhag.ashkenazi_forms).

Local only: uses the API keys in .env (never printed) and turns Sentry off so
a local run never alerts the error channel. Never point it at production.

    .venv/bin/python scripts/eval_minhag_ai.py [out.json]
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(".env", override=False)
os.environ["SENTRY_DSN"] = ""

from backend import claude, minhag  # noqa: E402

QUESTIONS = [
    "Can I make a bris on Shabbat if the eighth day falls then?",
    "What do we eat in the sukkah on the first night of Sukkot?",
    "Is it customary to stay up all night on Shavuot?",
    "What blessing do I say before eating rice?",
]
LENSES = ["Sefardic", "Iraqi", "Ashkenaz"]
COMMUNITY_WORDS = ("sephard", "sefard", "mizrahi", "edot", "iraqi", "baghdad", "ashkenaz")


def _answer_text(result):
    data = result if isinstance(result, dict) else {"answer": str(result)}
    structured = data.get("structured") if isinstance(data.get("structured"), dict) else {}
    parts = [str(data.get("answer") or "")]
    parts += [str(structured.get(key) or "") for key in ("ruling", "summary", "practical_steps")]
    return data, " ".join(parts)


def main(out_path=None):
    rows = []
    for question in QUESTIONS:
        for lens in LENSES:
            started = time.time()
            try:
                result = claude.ask_claude(question, [], [], community_lens=lens, answer_language="en")
            except Exception as exc:  # one failed call is a row, not the end of the run
                rows.append({"question": question, "lens": lens, "error": type(exc).__name__})
                continue
            data, text = _answer_text(result)
            rows.append({
                "question": question,
                "lens": lens,
                "model": data.get("model"),
                "seconds": round(time.time() - started, 1),
                "ashkenazi_forms": minhag.ashkenazi_forms(text),
                "names_community": any(word in text.lower() for word in COMMUNITY_WORDS),
                "answer": str(data.get("answer") or "")[:500],
            })
            print(json.dumps(rows[-1], ensure_ascii=False), flush=True)
    if out_path:
        with open(out_path, "w", encoding="utf-8") as handle:
            json.dump(rows, handle, ensure_ascii=False, indent=1)
    sephardi_rows = [r for r in rows if r.get("lens") != "Ashkenaz" and "error" not in r]
    flagged = [r for r in sephardi_rows if r["ashkenazi_forms"]]
    unnamed = [r for r in rows if "error" not in r and not r["names_community"]]
    print(f"Sephardi/Mizrahi answers with Ashkenazi forms: {len(flagged)}/{len(sephardi_rows)}; "
          f"answers not naming a community: {len(unnamed)}/{len(rows)}")
    return 1 if flagged else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else None))
