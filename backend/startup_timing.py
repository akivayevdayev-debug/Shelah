"""Cold-start timing: one log line per new server instance.

Vercel's request logs show how long each request spent inside the app, but
not how long a new instance took to start. api/index.py marks when the app
began and finished loading; the first request through asgi.py then logs
"cold_start" once with three numbers:

- process_age_ms: how old the Python process already was when the app began
  loading (Vercel's own start-up, Linux only, None elsewhere).
- import_ms: how long loading the app took.
- first_request_after_ms: how long after loading the first request arrived.

Standard library only, so importing it adds nothing to the start-up it
measures.
"""

from __future__ import annotations

import logging
import os
import threading
import time

_lock = threading.Lock()
_import_started: float | None = None
_import_done: float | None = None
_process_age_ms: float | None = None
_reported = False


def _process_start_epoch() -> float | None:
    """When this process started (seconds since the epoch), from /proc."""
    try:
        with open("/proc/self/stat", encoding="ascii") as stat_file:
            # Field 22 (starttime, clock ticks since boot) comes after the
            # command name, which is in parentheses and may contain spaces.
            fields = stat_file.read().rsplit(")", 1)[1].split()
        start_ticks = int(fields[19])
        with open("/proc/stat", encoding="ascii") as boot_file:
            boot_line = next(line for line in boot_file if line.startswith("btime "))
        boot_epoch = int(boot_line.split()[1])
        return boot_epoch + start_ticks / os.sysconf("SC_CLK_TCK")
    except (OSError, ValueError, IndexError, StopIteration, AttributeError):
        return None


def mark_import_start() -> None:
    """Called at the top of api/index.py, before the app is imported."""
    global _import_started, _process_age_ms
    _import_started = time.time()
    started = _process_start_epoch()
    if started is not None:
        _process_age_ms = round((_import_started - started) * 1000, 1)


def mark_import_done() -> None:
    """Called in api/index.py once the app has been imported."""
    global _import_done
    _import_done = time.time()


def cold_start_fields() -> dict | None:
    """The numbers to log, or None when the entry point never marked them."""
    if _import_started is None or _import_done is None:
        return None
    return {
        "process_age_ms": _process_age_ms,
        "import_ms": round((_import_done - _import_started) * 1000, 1),
        "first_request_after_ms": round((time.time() - _import_done) * 1000, 1),
    }


def report_once(logger: logging.Logger) -> None:
    """Log "cold_start" on this instance's first request, then never again."""
    global _reported
    if _reported:
        return
    with _lock:
        if _reported:
            return
        _reported = True
    fields = cold_start_fields()
    if fields is not None:
        logger.info("cold_start", extra=fields)
