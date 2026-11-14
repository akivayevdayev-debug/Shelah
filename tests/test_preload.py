"""Start-up skips the heavy libraries; backend/preload.py loads them after
the first response."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from backend import preload

REPO_ROOT = Path(__file__).resolve().parent.parent
HEAVY_LIBRARIES = ("timezonefinder", "numpy", "jwt", "cryptography.hazmat", "anthropic", "google.genai")


@pytest.fixture(scope="module")
def loaded_at_startup():
    """Which heavy libraries a fresh `import api.index` loads."""
    probe = (
        "import json, sys; import api.index; "
        f"print(json.dumps([m for m in {list(HEAVY_LIBRARIES)!r} if m in sys.modules]))"
    )
    env = {**os.environ, "PYTHONPATH": str(REPO_ROOT)}
    env.pop("VERCEL", None)
    result = subprocess.run(
        [sys.executable, "-c", probe], cwd=REPO_ROOT, env=env,
        capture_output=True, text=True, timeout=120, check=True,
    )
    return json.loads(result.stdout.strip().splitlines()[-1])


@pytest.mark.parametrize("library", HEAVY_LIBRARIES)
def test_startup_does_not_load(library, loaded_at_startup):
    assert library not in loaded_at_startup


@pytest.fixture
def fresh_preload(monkeypatch):
    monkeypatch.setattr(preload, "_started", False)
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.delenv("PRELOAD_LIBRARIES", raising=False)
    calls = []
    monkeypatch.setattr(preload, "TASKS", (lambda: calls.append("ran"),))
    return calls


def test_preload_is_off_outside_vercel(fresh_preload):
    assert preload.start_once() is None


def test_preload_runs_its_tasks_on_vercel(monkeypatch, fresh_preload):
    monkeypatch.setenv("VERCEL", "1")
    preload.start_once().join(timeout=5)
    assert fresh_preload == ["ran"]


def test_preload_starts_only_once(monkeypatch, fresh_preload):
    monkeypatch.setenv("PRELOAD_LIBRARIES", "1")
    preload.start_once().join(timeout=5)
    assert preload.start_once() is None


def test_a_failing_task_does_not_stop_the_rest(monkeypatch, fresh_preload):
    def broken():
        raise RuntimeError("no wheel")

    monkeypatch.setattr(preload, "TASKS", (broken, lambda: fresh_preload.append("ran")))
    monkeypatch.setenv("VERCEL", "1")
    preload.start_once().join(timeout=5)
    assert fresh_preload == ["ran"]


def test_the_real_tasks_load_the_timezone_finder():
    from backend import zmanim_engine

    preload._timezone_finder()
    assert zmanim_engine._tf is not None
