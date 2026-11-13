"""api/index.py is Vercel's serverless entrypoint: a thin re-export of the
canonical ASGI app. Executing it must expose that exact object as `app`
(Vercel's Python runtime serves whatever `app` is) and leave the repo root
importable."""

from __future__ import annotations

import os
import runpy
import sys

import pytest

import asgi

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_the_entrypoint_exposes_the_canonical_asgi_app(monkeypatch):
    monkeypatch.setattr(sys, "path", list(sys.path))

    namespace = runpy.run_path(os.path.join(_REPO_ROOT, "api", "index.py"))

    assert namespace["app"] is asgi.app


def test_the_entrypoint_puts_the_repo_root_first_on_sys_path(monkeypatch):
    monkeypatch.setattr(sys, "path", [entry for entry in sys.path if entry != _REPO_ROOT])

    runpy.run_path(os.path.join(_REPO_ROOT, "api", "index.py"))

    assert sys.path[0] == _REPO_ROOT


def _vercel_entrypoint() -> str:
    import tomllib

    with open(os.path.join(_REPO_ROOT, "pyproject.toml"), "rb") as config:
        return tomllib.load(config)["tool"]["vercel"]["entrypoint"]


def test_vercel_is_told_to_serve_the_asgi_app():
    # Without a named entry point Vercel serves app.py's bare Flask app and
    # skips asgi.py (rate limiter, body cap, FastAPI /ask).
    import importlib

    module_name, attribute = _vercel_entrypoint().split(":")

    assert getattr(importlib.import_module(module_name), attribute) is asgi.app


def test_vercel_json_function_settings_name_the_entrypoint_file():
    import json

    with open(os.path.join(_REPO_ROOT, "vercel.json"), encoding="utf-8") as config:
        functions = json.load(config)["functions"]
    entry_file = _vercel_entrypoint().split(":")[0].replace(".", "/") + ".py"

    assert entry_file in functions


def test_vercel_json_uses_the_asgi_framework_preset():
    import json

    with open(os.path.join(_REPO_ROOT, "vercel.json"), encoding="utf-8") as config:
        framework = json.load(config)["framework"]

    assert framework == "fastapi"


def test_pyproject_dependencies_match_requirements_txt():
    # Vercel installs pyproject.toml's list; everything else reads
    # requirements.txt. The two must name the same pins.
    import tomllib

    with open(os.path.join(_REPO_ROOT, "pyproject.toml"), "rb") as config:
        declared = tomllib.load(config)["project"]["dependencies"]
    with open(os.path.join(_REPO_ROOT, "requirements.txt"), encoding="utf-8") as requirements:
        pinned = [line.strip() for line in requirements if line.strip() and not line.lstrip().startswith("#")]

    assert declared == pinned


@pytest.mark.parametrize("path", ["/openapi.json", "/docs", "/redoc"])
def test_fastapi_does_not_publish_its_api_description(path):
    from fastapi.testclient import TestClient

    response = TestClient(asgi.app).get(path)

    # The JSON spec and both docs pages all name "openapi"; Flask's 404 does not.
    assert "openapi" not in response.text.lower()
