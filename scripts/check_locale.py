"""Check one locale's catalog against English before it is switched on.

    .venv/bin/python scripts/check_locale.py es

Reports, per namespace: keys missing from the locale (legal namespaces may be
missing on purpose -- they fall back to English), keys English doesn't have,
placeholders that differ, empty strings, and strings that are mostly not in the
locale's script (names in meta.json keep_names are ignored). Exit 1 on any
problem outside LEGAL_NAMESPACES' missing keys.
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES = ROOT / "locales"

# English stays authoritative for these until the owner decides otherwise;
# a missing key falls back to English at render time.
LEGAL_NAMESPACES = frozenset({
    "privacy", "terms", "acceptable_use", "dmca", "ai_disclosure", "licenses", "accessibility",
})

_PLACEHOLDER = re.compile(r"\{[a-z_]+\}")


def _share_in_script(text: str, script: str, keep: list[str]) -> float:
    text = _PLACEHOLDER.sub("", text)
    for name in keep:
        text = text.replace(name, "")
    letters = [ch for ch in text if ch.isalpha()]
    if not letters:
        return 1.0
    return sum(script.upper() in unicodedata.name(ch, "") for ch in letters) / len(letters)


def check(code: str) -> list[str]:
    meta = json.loads((LOCALES / "meta.json").read_text(encoding="utf-8"))
    locale = next(item for item in meta["locales"] if item["code"] == code)
    keep = sorted(meta["keep_names"], key=len, reverse=True)
    exempt = set(meta["script_exempt"])
    problems: list[str] = []
    for en_path in sorted((LOCALES / "en").glob("*.json")):
        ns = en_path.stem
        english = json.loads(en_path.read_text(encoding="utf-8"))
        path = LOCALES / code / en_path.name
        if not path.exists():
            if ns not in LEGAL_NAMESPACES:
                problems.append(f"{ns}: file missing")
            continue
        theirs = json.loads(path.read_text(encoding="utf-8"))
        for key in sorted(set(english) - set(theirs)):
            problems.append(f"{ns}.{key}: missing")
        for key in sorted(set(theirs) - set(english)):
            problems.append(f"{ns}.{key}: not in English")
        for key in sorted(set(english) & set(theirs)):
            text = theirs[key]
            if not isinstance(text, str) or not text.strip():
                problems.append(f"{ns}.{key}: empty")
                continue
            if sorted(_PLACEHOLDER.findall(english[key])) != sorted(_PLACEHOLDER.findall(text)):
                problems.append(f"{ns}.{key}: placeholders differ")
            full = f"{ns}.{key}"
            if full not in exempt and _share_in_script(text, locale["script"], keep) < 0.5:
                problems.append(f"{ns}.{key}: mostly not {locale['script']}: {text[:60]!r}")
    return problems


def main() -> int:
    code = sys.argv[1]
    problems = check(code)
    for line in problems:
        print(line)
    print(f"{code}: {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
