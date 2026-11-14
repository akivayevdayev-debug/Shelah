"""Load the libraries that only some requests use, right after a new
instance answers its first request.

Start-up skips the heavy libraries: the AI SDKs (anthropic, google-genai),
timezonefinder with numpy, and PyJWT with cryptography. Each loads the first
time something needs it. On a new instance the visitor's next requests are
likely to need them (the page asks for zmanim, a signed-in visitor sends a
token, a question goes to the AI), so asgi.py calls start_once() after the
first response, and a background thread loads them while the visitor reads
the page. No extra requests are made: everything here is imports and
in-process setup.

The thread only runs on Vercel (VERCEL=1), or when PRELOAD_LIBRARIES=1 forces
it, so local runs and the test suite keep the plain load-on-first-use path.
"""

from __future__ import annotations

import logging
import os
import threading
from collections.abc import Callable

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_started = False


def _timezone_finder() -> None:
    from backend.zmanim_engine import get_timezone_finder

    get_timezone_finder()


def _token_verifier() -> None:
    import jwt  # noqa: F401  (the import is the work)


def _ai_sdks() -> None:
    from backend import claude

    claude._ensure_anthropic_loaded()
    claude._ensure_genai_loaded()


# Most likely needed first comes first: the zmanim card asks on page load.
TASKS: tuple[Callable[[], None], ...] = (_timezone_finder, _token_verifier, _ai_sdks)


def _enabled() -> bool:
    return os.environ.get("VERCEL") == "1" or os.environ.get("PRELOAD_LIBRARIES") == "1"


def _run(tasks: tuple[Callable[[], None], ...]) -> None:
    for task in tasks:
        try:
            task()
        except Exception:  # noqa: BLE001 - a failed preload only means loading on first use
            logger.warning("preload_failed", extra={"task": task.__name__}, exc_info=True)


def start_once() -> threading.Thread | None:
    """Start the preload thread the first time this is called on an enabled
    instance; return it, or None when it was already started or is off."""
    global _started
    if not _enabled():
        return None
    with _lock:
        if _started:
            return None
        _started = True
    thread = threading.Thread(target=_run, args=(TASKS,), name="preload", daemon=True)
    thread.start()
    return thread
