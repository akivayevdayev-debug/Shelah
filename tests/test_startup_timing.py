"""backend/startup_timing.py logs one "cold_start" line per new instance."""

from __future__ import annotations

import logging

import pytest

from backend import startup_timing


@pytest.fixture(autouse=True)
def _fresh_state(monkeypatch):
    monkeypatch.setattr(startup_timing, "_import_started", None)
    monkeypatch.setattr(startup_timing, "_import_done", None)
    monkeypatch.setattr(startup_timing, "_process_age_ms", None)
    monkeypatch.setattr(startup_timing, "_reported", False)


def _cold_start_records(caplog):
    return [r for r in caplog.records if r.getMessage() == "cold_start"]


def _marked_logger(monkeypatch, clock):
    monkeypatch.setattr(startup_timing.time, "time", lambda: clock[0])
    startup_timing.mark_import_start()
    clock[0] += 1.5
    startup_timing.mark_import_done()
    clock[0] += 0.25
    return logging.getLogger("test.startup_timing")


def test_the_first_request_logs_cold_start_once(monkeypatch, caplog):
    logger = _marked_logger(monkeypatch, [1000.0])
    with caplog.at_level(logging.INFO, logger="test.startup_timing"):
        startup_timing.report_once(logger)
        startup_timing.report_once(logger)

    assert len(_cold_start_records(caplog)) == 1


def test_cold_start_reports_the_load_time(monkeypatch, caplog):
    logger = _marked_logger(monkeypatch, [1000.0])
    with caplog.at_level(logging.INFO, logger="test.startup_timing"):
        startup_timing.report_once(logger)

    assert _cold_start_records(caplog)[0].import_ms == 1500.0


def test_cold_start_reports_the_wait_for_the_first_request(monkeypatch, caplog):
    logger = _marked_logger(monkeypatch, [1000.0])
    with caplog.at_level(logging.INFO, logger="test.startup_timing"):
        startup_timing.report_once(logger)

    assert _cold_start_records(caplog)[0].first_request_after_ms == 250.0


def test_process_age_comes_from_the_process_start(monkeypatch):
    monkeypatch.setattr(startup_timing, "_process_start_epoch", lambda: 997.0)
    monkeypatch.setattr(startup_timing.time, "time", lambda: 1000.0)

    startup_timing.mark_import_start()

    assert startup_timing._process_age_ms == 3000.0


def test_nothing_is_logged_when_the_entry_point_never_marked(caplog):
    with caplog.at_level(logging.INFO, logger="test.startup_timing"):
        startup_timing.report_once(logging.getLogger("test.startup_timing"))

    assert _cold_start_records(caplog) == []


def test_process_start_is_none_without_proc(monkeypatch):
    def _no_proc(*_args, **_kwargs):
        raise OSError("no /proc here")

    monkeypatch.setattr("builtins.open", _no_proc)

    assert startup_timing._process_start_epoch() is None


def test_process_start_reads_linux_proc(monkeypatch):
    # Field 22 (starttime) is the 20th field after the "(name)" part.
    after_name = ["S"] + ["0"] * 18 + ["500", "0"]
    files = {
        "/proc/self/stat": "4242 (python3 api index) " + " ".join(after_name),
        "/proc/stat": "cpu  1 2 3\nbtime 1000\n",
    }

    def _fake_open(path, *_args, **_kwargs):
        import io

        return io.StringIO(files[path])

    monkeypatch.setattr("builtins.open", _fake_open)
    monkeypatch.setattr(startup_timing.os, "sysconf", lambda _name: 100)

    assert startup_timing._process_start_epoch() == 1005.0
